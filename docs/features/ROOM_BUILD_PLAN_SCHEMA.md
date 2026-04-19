# Room Build-Plan Schema Extension

**Path:** `public/data/rooms.json`
**Companion to:** [GROW_SYSTEMS_TEMPLATE_SCHEMA.md](./GROW_SYSTEMS_TEMPLATE_SCHEMA.md)
**Related proposal sections:** [§3](./FARM_SETUP_WORKFLOW_PROPOSAL.md#3-where-does-each-assignment-belong) / [§4](./FARM_SETUP_WORKFLOW_PROPOSAL.md#4-concrete-next-steps-if-you-want-to-move-on-this) of the farm setup workflow proposal.

This document describes the Phase-A fields added to `rooms.json` so a
room can carry enough information for the load-math calculator (Phase-A
step 3) and the device-discovery auto-assign (Phase-B step 7) to do
their jobs.

All new fields are **optional** so pre-Phase-A rooms continue to
validate. A room becomes "Phase-A ready" when `dimensions`, `envelope`,
and at least one entry in `installedSystems` are populated; the
calculator then produces a `buildPlan`, and the grower accepts it to
flip `buildPlan.status` from `draft` to `accepted`.

---

## Fields added to each room entry

| Field | Type | Required | Notes |
|---|---|---|---|
| `dimensions` | object | no (Phase-A required) | Physical footprint in metres — see subfields below. |
| `envelope` | object | no (Phase-A required) | Building envelope class — drives HVAC / dehum sizing. |
| `installedSystems` | array | no (Phase-A required) | Grow-system templates installed in the room. |
| `buildPlan` | object | no | Output of the load-math calculator + accepted BOM. |
| `controllerAnchor` | object | no | Room-level vendor-cloud / wired controller anchor. |

The existing `category.*`, `hardwareCats`, `connectivity`, `zones`,
`fixtures`, and other pre-Phase-A fields are unchanged. `buildPlan`
will eventually supersede `category.*` for sizing decisions, but both
coexist during migration so legacy consumers keep working.

### `dimensions`

```jsonc
{
  "lengthM": 4.8,
  "widthM": 3.6,
  "ceilingHeightM": 3.0
}
```

All three subfields are required when `dimensions` is present and must
be `> 0`. The calculator uses `lengthM * widthM` as the room floor
area and `ceilingHeightM` as the air volume for HVAC / dehum sizing.

### `envelope`

```jsonc
{
  "class": "typical",
  "notes": "Insulated shipping container conversion, no exterior windows."
}
```

`class` is a closed enum:

| Value | Meaning |
|---|---|
| `well_insulated` | Purpose-built grow room with vapor barrier + R-20+ walls. |
| `typical` | Converted basement / warehouse with standard construction. |
| `poorly_insulated` | Thin walls, significant infiltration, or unconditioned exterior. |
| `outdoor_ambient` | Greenhouse / polytunnel — climate tracks outdoor ambient. |

The calculator multiplies the envelope class into HVAC / dehum sizing.

### `installedSystems`

```jsonc
[
  {
    "templateId": "nft-rack-3tier",
    "quantity": 6,
    "position": "north wall, rows 1–2",
    "zoneId": "zone-1"
  }
]
```

Every `templateId` must resolve against
`public/data/grow-systems.json → templates[].id`. This is enforced by
the cross-file check in `scripts/validate-all-schemas.js` — dangling
references fail CI. `quantity` is a positive integer. `position` and
`zoneId` are optional annotations for the UI / zone binding.

### `buildPlan`

```jsonc
{
  "status": "draft",
  "generatedAt": "2026-04-18T20:30:00Z",
  "computedLoad": {
    "lightingKW": 7.2,
    "coolingTons": 2.5,
    "dehumLPerDay": 95,
    "supplyFanCFM": 450,
    "pumpKW": 0.9,
    "totalCircuitKW": 11.4
  },
  "acceptedEquipment": [
    {
      "category": "hvac",
      "equipmentRef": "mitsubishi-pkz-35",
      "quantity": 1,
      "notes": "3-ton mini-split"
    }
  ],
  "reservedControllerSlots": [
    {
      "subsystem": "lights",
      "controllerClass": "0_10v",
      "channels": 12,
      "templateId": "nft-rack-3tier",
      "zoneId": "zone-1"
    }
  ]
}
```

| Subfield | Notes |
|---|---|
| `status` | `draft` (calculator output, not yet accepted), `accepted` (grower committed to the plan), `stale` (inputs changed since acceptance — recompute). |
| `generatedAt` | ISO-8601 timestamp of the calculator run. |
| `computedLoad` | Numeric outputs of the calculator. All fields `>= 0`. This is what the calculator library returns; the grower does not edit it directly. |
| `acceptedEquipment` | BOM the grower accepted. `category` is free-form today (e.g. `hvac`, `dehumidifier`, `circulation_fan`); `equipmentRef` can point at a catalog entry (e.g. an `equipment-kb.json` id) once that integration lands. |
| `reservedControllerSlots` | Channel reservations that Phase-B device discovery binds real devices into. `subsystem` is the closed enum `lights | pumps | fans | sensors`. `controllerClass` uses the same vocabulary as `grow-systems.json → templates[].defaultControllerClass.*.type`. |

### `controllerAnchor`

```jsonc
{
  "kind": "switchbot_cloud",
  "vendor": "SwitchBot",
  "tenantRef": "ops@greenreachfarms.com",
  "notes": "Account also hosts Farm B's meters."
}
```

`kind` is a closed enum:

| Value | Meaning |
|---|---|
| `switchbot_cloud` | SwitchBot Cloud API tenant. |
| `kasa_cloud` | TP-Link Kasa Cloud account. |
| `code3_cloud` | Code3 grid-control cloud. |
| `dmx_universe` | Direct DMX-over-IP / Art-Net universe. |
| `direct_wired` | Wired controller bus (GROW3 HTTP, I2C/SPI/1-Wire/UART). |
| `mixed` | More than one of the above — use `notes` to describe. |
| `none` | Room has no controller anchor yet (Phase-A draft, pre-discovery). |

Device identities (MAC, DMX universe numbers, deviceIds, cloud access
tokens) still live in `iot-devices.json` — the `controllerAnchor`
merely names **which** anchor the discovered devices will be attached
to. `tenantRef` is intentionally a free-form opaque string so different
vendors can use different identifier schemes without schema churn.

---

## Schema enforcement

The JSON Schema for these fields lives in `lib/schema-validator.js`
(`validateRooms`) and runs as part of `npm run validate-schemas` in
the `validate-and-test` CI job. CI fails on:

- Unknown `envelope.class`, `buildPlan.status`, `reservedControllerSlots[].subsystem`, or `controllerAnchor.kind` values (closed enums).
- Missing required subfields on `dimensions`, `envelope`, `installedSystems[]`, `acceptedEquipment[]`, `reservedControllerSlots[]`, or `controllerAnchor`.
- Extra unknown fields on any of the new subobjects (`additionalProperties: false`). This keeps device identities out of the build plan — they have to live in `iot-devices.json`.
- Dangling `templateId` references across `installedSystems`,
  `buildPlan.acceptedEquipment`, and `buildPlan.reservedControllerSlots`
  — every `templateId` must resolve against
  `grow-systems.json → templates[].id`. See
  `scripts/validate-all-schemas.js → runCrossFileChecks`.

The pre-Phase-A fields on a room (`hardwareCats`, `category.*`,
`connectivity`, etc.) are still tolerated via the root
`additionalProperties: true` on each room entry.

---

## Consumers (current and planned)

**Currently:** no runtime code reads these fields yet — this PR adds
the schema and validator only. The existing setup wizard and Farm
Setup dashboard continue to read the pre-Phase-A fields.

**Planned (per FARM_SETUP_WORKFLOW_PROPOSAL.md §4):**

- **Step 3** — `lib/farm-load-calculator.js` reads `dimensions`,
  `envelope`, `installedSystems` + the referenced templates, and emits
  `buildPlan.computedLoad` / `reservedControllerSlots`.
- **Step 3** — `POST /api/setup/room-build-plan` wraps the calculator
  so the Farm Setup dashboard and the `setup-agent` phase can both
  request a fresh plan.
- **Step 4** — the merged `room_build` phase in
  `greenreach-central/routes/setup-agent.js` persists `buildPlan`
  drafts and flips them to `accepted`.
- **Step 6** — `controller-bindings.json` references this room's
  `reservedControllerSlots` so Phase-B device discovery can bind real
  devices into each reservation. `controllerAnchor` picks the discovery
  channel (SwitchBot Cloud pull, DMX universe probe, GROW3 HTTP scan).

---

## Migration

Existing `rooms.json` rows are **not** rewritten by this PR — all new
fields are optional, so every existing row continues to validate.
Populating the new fields is a per-room migration that happens when a
grower goes through the new Phase-A flow (once steps 3 and 4 land).

The existing `layout`, `category.*`, and `connectivity` blocks remain
the source of truth until the calculator library ships. After that,
`buildPlan.computedLoad` + `acceptedEquipment` will be authoritative
for sizing and `category.*` becomes a legacy mirror.
