# Grow Systems Template Schema

**Path:** `public/data/grow-systems.json`
**Purpose:** Class-level catalog of the physical growing apparatuses the
farm can install in a room. Templates declare the *class and required
channel counts* of their equipment; they do **not** hold device
identities (MAC addresses, DMX universes, Kasa deviceIds, SwitchBot
deviceIds, etc.). Device identities live in `iot-devices.json` and bind
to templates via the room build plan (Phase A) and device discovery
(Phase B).

This file exists so the Phase A "build the farm" step in
[FARM_SETUP_WORKFLOW_PROPOSAL.md](./FARM_SETUP_WORKFLOW_PROPOSAL.md) has
a catalog to pick from. The load-math library (Phase A step 3 of §4 in
that proposal, currently unimplemented — see §1d) will read these
fields; the Farm Setup dashboard will list these templates in the Grow
Rooms modal.

Formula references point back to
[VERTICAL_FARM_CALCULATOR_SPEC.md](./VERTICAL_FARM_CALCULATOR_SPEC.md).

---

## File shape

```jsonc
{
  "version": "string, ISO date + suffix",
  "description": "string",
  "cropClasses": ["leafy_greens", "microgreens", "herbs", "fruiting"],
  "templates": [ /* Template[] */ ]
}
```

`cropClasses` is the closed enum used as a key in every per-class map
below. Values align with `crop-registry.json → crops[].nutrientProfile`
so the calculator can resolve a crop to its class.

---

## Template fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string (slug) | yes | Stable identifier. Rooms reference templates by `id`. |
| `name` | string | yes | Human-readable label. |
| `category` | enum | yes | `nft_rack | dwc_pond | vertical_tier | microgreen_shelf | flood_table | ebb_flow_bench | drip_rail` |
| `description` | string | yes | One-line summary. |
| `suitableCropClasses` | `cropClasses[]` | yes | Which crop classes this apparatus can host. Drives UI filtering. |
| `footprintM` | `{ length, width }` | yes | Outer footprint in metres. Used for room-area bookkeeping. |
| `heightM` | number | yes | Total height incl. top tier + clearance. |
| `tierCount` | integer | yes | Number of stacked grow levels. Single-level systems = 1. |
| `traysPerTier` | integer | yes | Trays each tier can hold (using the standard 24" × 28" tray). |
| `trayFormat` | `{ lengthIn, widthIn, plantsPerTrayDefault }` | yes | Tray geometry + a single fallback plants-per-tray for UI. |
| `plantsPerTrayByClass` | `Record<cropClass, integer>` | yes | Per-class plant density overrides used by the calculator. |
| `irrigation` | object, see below | yes | Plumbing sizing inputs. |
| `transpiration` | object, see below | yes | Inputs for latent-heat load math. |
| `defaultFixtureClass` | object, see below | yes | Per-class PPFD/DLI/photoperiod + fixture sizing (no specific SKUs). |
| `defaultControllerClass` | object, see below | yes | Per-subsystem controller **class** (not vendor). Step 6 of the proposal will bind real devices to these slots. |
| `requiredChannels` | object, see below | yes | Channel multipliers the calculator uses to size controllers. |
| `powerClassW` | object, see below | yes | Nominal continuous wattage per subsystem; feeds electrical-panel sizing. |
| `references` | object | no | Free-form links to spec sections or engineering notes. |

### `irrigation`

| Subfield | Type | Notes |
|---|---|---|
| `type` | enum | `nft | dwc | aero | flood | drip` |
| `supplyPumpWattsPer10kPlants` | number | Continuous supply-pump wattage. VFC §"Hydroponic System" uses 300 W for 10k plants. |
| `returnPumpWattsPer10kPlants` | number | Continuous return-pump wattage (150 W for 10k plants in VFC spec). |
| `dutyCycle` | number (0–1) | Effective-on fraction for OPEX math. VFC uses 0.5 (15 min on / 15 min off). |
| `reservoirGalPerPlant` | number | VFC rule of thumb is 1 gal/plant. |
| `plumbingCostPer10kPlantsUsd` | number | Ballpark CAPEX. |

### `transpiration`

| Subfield | Type | Notes |
|---|---|---|
| `gPerPlantPerDayByClass` | `Record<cropClass, number>` | Per-class mean transpiration. VFC baseline is 30 g/day for mature leafy greens. |
| `sensibleHeatFactor` | number | Multiplier added to the latent BTU/hour load to cover lights/pumps sensible heat. VFC uses 0.30. |

### `defaultFixtureClass`

| Subfield | Type | Notes |
|---|---|---|
| `ppfdTargetByClass` | `Record<cropClass, number>` | µmol/m²/s. Leafy 300–400, fruiting 600+ per VFC. |
| `dliTargetByClass` | `Record<cropClass, number>` | mol/m²/day, consumed by `lighting-recipes.json` targeting. |
| `efficacyUmolPerJ` | number | Modern LED efficacy assumption (VFC: 2.7). |
| `fixtureWattsNominal` | number | Per-fixture nameplate watts. VFC assumes 100 W. |
| `fixturesPerTierUnit` | integer | VFC assumes 2 × 100 W fixtures per tray level. |
| `photoperiodHoursByClass` | `Record<cropClass, number>` | Per-class on-hours. VFC: leafy 16, microgreens 18, fruiting 14–16. |

### `defaultControllerClass`

Describes the controller **class** required per subsystem. Concrete
vendor/model binding happens in Phase B (the proposal's step 6), which
uses this information to match discovered devices to reserved slots.

| Subfield | Type | Notes |
|---|---|---|
| `lights.type` | enum | `dmx_4 | 0_10v | smart_plug | direct_wired` |
| `lights.channelsPerFixturePair` | number | Channels each 2-fixture set needs. |
| `pumps.type` | enum | `smart_plug | relay | modbus` |
| `pumps.channelsPerPumpPair` | number | Channels per supply + return pair. |
| `fans.type` | enum | `ec_fan | pwm | smart_plug` |
| `fans.channelsPerFan` | number | Channels per fan. |
| `sensors.type` | enum | `switchbot_cloud | modbus | 1_wire | http` |
| `sensors.channelsPerZone` | number | Sensor channels (or cloud-API slots) reserved per zone. |

### `requiredChannels`

Multipliers the load calculator uses to translate `quantity × template`
into real channel demand. All numbers are positive integers.

| Subfield | Notes |
|---|---|
| `lightsPerTier` | Channel count per tier of this template. |
| `pumpsPer10kPlants` | Supply + return pair channels per 10,000 plants. |
| `fansPer5Racks` | Circulation-fan channels per 5 stacked racks of this template. |
| `sensorsPerZone` | Temperature/RH/VPD-grade sensor channels per zone. |

### `powerClassW`

Nominal continuous wattage by subsystem; used to size breakers/panel
capacity and to feed OPEX.

| Subfield | Notes |
|---|---|
| `lightsPerTierUnit` | Watts per tier of lighting (VFC: 2 × 100 W = 200 W). |
| `pumpsPer10kPlants` | Watts of pump load per 10k plants (VFC: 300 + 150 = 450 W). |
| `fansPerUnit` | Watts per circulation fan (VFC: 20" industrial ≈ 80 W). |

---

## Crop class glossary

| Class | Example crops | Nutrient profile (crop-registry) |
|---|---|---|
| `leafy_greens` | Butter lettuce, bibb, pak choi, kale (baby) | `leafy_greens` |
| `microgreens` | Sunflower, radish, pea shoots | `microgreens` |
| `herbs` | Basil, cilantro, mint | `herbs` |
| `fruiting` | Strawberry, tomato, pepper | `fruiting` |

The registry may grow, but class additions must be coordinated with the
calculator library so every per-class map in this file stays complete.

---

## Field discipline

Two invariants every template must maintain:

1. **No device identities.** Never put a MAC address, DMX universe,
   SwitchBot deviceId, Kasa deviceId, Modbus address, firmware string,
   or cloud-tenant ID here. Those live in `iot-devices.json`.
2. **Every `*ByClass` map must cover all four crop classes.** Missing
   keys will break the calculator's default resolution. When adding a
   new crop class to the top-level `cropClasses` enum, every existing
   template must add the corresponding entries in the same PR.

---

## Consumers (current and planned)

- **Current (none).** This registry is not yet read at runtime.
- **Planned — Phase A step 3 in the proposal:** a
  `lib/farm-load-calculator.js` library lifts the VFC formulas and
  consumes `irrigation`, `transpiration`, `defaultFixtureClass`,
  `requiredChannels`, and `powerClassW`.
- **Planned — Phase A step 4 in the proposal:**
  `POST /api/setup/room-build-plan` accepts `{ room, systems[],
  cropClass }` where `systems[]` references template `id`s, runs the
  calculator, and returns the build plan.
- **Planned — Phase A step 5:** the Farm Setup dashboard Grow Rooms
  modal surfaces these templates as picker options; the setup agent's
  merged `room_build` phase drives the same picker.
