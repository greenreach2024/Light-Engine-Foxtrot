# 10 — Farm Builder Playbook (active equipment & layout recommendation)

**Owner:** Setup-Agent + E.V.I.E. + Farm-Ops-Agent (shared); human gate: central admin on first build, farm operator on re-builds
**Canonical references:** `.github/COMPLETE_SYSTEM_MAP.md` §2–§5, this repo's `greenreach-central/lib/farm-builder.js`, `greenreach-central/lib/equipment-db.js`, `public/data/grow-systems.json`, `public/data/equipment-kb.json`, `public/data/lighting-recipes.json`
**Related playbooks:** 02 (AI Agent Platform), 07 (Farm Operations), 09 (Admin & Platform Ops)

---

## 1. Purpose & scope

Light Engine Foxtrot today treats farm setup as **passive**: the operator tells the system what equipment exists, which rooms, and which growing system. The 3D viewer then renders that input, and recipes drive targets from there. The platform has no opinion on whether the equipment is right, right-sized, or right for the climate the farm is in.

The **Farm Builder** flips this. Given:

- **Location** — latitude / longitude / timezone → design-day outdoor conditions (temperature, humidity, solar) and climate zone
- **Building** — floor area, ceiling height, insulation tier (envelope U-value if known)
- **Growing system** — one of `nft_rack | dwc_pond | vertical_tower | ebb_flow | dutch_bucket | aeroponics` (or a template id from `grow-systems.json.templates[]`)
- **Crop plan** — crop class or crop names with tray/site counts and priority

the Farm Builder produces a **proposal** the operator reviews, tweaks, and accepts: zones, lights (fixture + count + PPFD/DLI/photoperiod), HVAC (cooling tonnage, mini-split vs central, ventilation CFM), dehumidification (PPD), irrigation (pump + reservoir + plumbing), controls (channel plan), a BOM grouped by SKUs from `equipment-kb.json`, and the per-zone operating envelope.

**Design principle:** operators are users of a recommendation, not authors of a bill of materials.

## 2. Who owns this

| Role | Responsibility |
|---|---|
| Setup-Agent | Orchestrates inputs, invokes builder, checks phase completion |
| E.V.I.E. | Surfaces recommendation, walks operator through review, executes `recommend_farm_layout` + follow-up `add_equipment`/`update_equipment` |
| Farm-Ops-Agent | Validates proposed targets against recipes; raises alerts if live environment drifts from proposed envelope |
| Central admin | Gate on first build per tenant; audits results |
| Farm operator | Accepts, tweaks, or rejects proposal; stays in control |

## 3. Top-level data model

| Concept | Where it lives | Notes |
|---|---|---|
| `farm_profile.location` | `farm_data.farm_profile` JSONB | `{ lat, lng, tz, country, region, postal_code }` |
| `farm_profile.design_envelope` | `farm_data.farm_profile` JSONB (**new**, Phase C) | `{ winter_99_dryBulb_C, summer_1_dryBulb_C, summer_meanCoincidentWetBulb_C, climateZone, envelope_U_Wm2K, source, computedAt }` |
| `rooms[*].dimensions` | `rooms` store | `{ length_m, width_m, area_m2, ceiling_height_m }` |
| `rooms[*].hydro_system` | `rooms` store | key into `HYDRO_SYSTEM_DB` / `grow-systems.json.templates[]` |
| `rooms[*].hvac_type` | `rooms` store | `mini_split | portable | central` |
| `farm_proposals` | **new** JSONB store | `{ id, farmId, createdAt, status: 'draft'|'accepted'|'rejected', inputs, output, acceptedBy, acceptedAt }` |
| `groups[*].planConfig.template_id` | `groups` store (**new** stamp) | template id from `grow-systems.json` so resolver can recompute density / PPFD |
| Equipment KB | `public/data/equipment-kb.json` | 66 real SKUs; read-only in this flow, maintained out-of-band |
| Hydro / growing system KB | `public/data/grow-systems.json` (canonical) + `equipment-db.js HYDRO_SYSTEM_DB` (to be auto-generated) | See §9 |
| Lighting recipes | `public/data/lighting-recipes.json` | Keyed by canonical crop name; provides PPFD / DLI / photoperiod schedule |
| Crop registry | `public/data/crop-registry.json` | 32 crops with `aliases[]`, `planIds[]`, `nutrientProfile`, `growth`, `pricing`, `market` |

## 4. Key files

### Light Engine (LE, per-tenant)
- `public/views/farm-setup.html` — setup surface; gains a `farm-step="build"` step between `spaces` and `review` (Phase B1)
- `public/views/3d-farm-viewer.html` — renders accepted proposals; supports preview overlay for draft proposals (Phase B2)
- `public/setup-wizard.html` — first-boot wizard; optional "Quick Build" shortcut to the new step
- `public/LE-migration-wizard.html` — retrofit flow; same builder hook
- `public/data/grow-systems.json`, `public/data/equipment-kb.json`, `public/data/lighting-recipes.json`, `public/data/crop-registry.json`

### Central (cross-tenant)
- `greenreach-central/lib/farm-builder.js` (467 L) — core: `buildFarmLayout(inputs)`; add `buildFarmLayout_v2(inputs)` that also takes `designEnvelope` and `template` (Phase C2)
- `greenreach-central/lib/equipment-db.js` (572 L) — `LIGHT_DB`, `FAN_DB`, `DEHUMIDIFIER_DB`, `HVAC_DB`, `HYDRO_SYSTEM_DB`; the latter becomes derived from `grow-systems.json` at import time (Phase C4)
- `greenreach-central/lib/design-conditions.js` (**new**, Phase C1) — `getDesignConditions(lat, lng)` → ASHRAE / TMY / lat-band fallback
- `greenreach-central/routes/setup-agent.js` — 12-phase catalogue; add a new phase `growing_system_choice` between `room_specs` and `crop_assignment` (Phase B1)
- `greenreach-central/routes/assistant-chat.js` — tools: `recommend_farm_layout`, `apply_crop_environment`, `add_equipment`, `update_equipment`, `remove_equipment`, `align_equipment_to_walls`, `optimize_layout`, `list_available_crops`, `get_crop_recipe_targets`, `update_room_specs`, `get_outdoor_weather`; add `get_design_conditions` (Phase C1) and `propose_farm_layout` / `accept_farm_proposal` wrappers (Phase B1)

## 5. API surface

### Planned (to land in Phases B–C)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/farm-builder/propose` | Thin LE proxy; forwards inputs to Central `buildFarmLayout_v2`, stores result in `farm_proposals` with `status='draft'`, returns proposal id + payload |
| GET | `/api/farm-builder/proposals/:id` | Read proposal |
| POST | `/api/farm-builder/proposals/:id/accept` | Writes rooms / zones / groups / devices per proposal, stamps `groups[*].planConfig.template_id`, sets proposal `status='accepted'` |
| POST | `/api/farm-builder/proposals/:id/reject` | Marks `status='rejected'` with reason |
| GET | `/api/farm-builder/design-conditions?lat=…&lng=…` | Cached design-envelope lookup |

### Already present
- EVIE tools `recommend_farm_layout`, `update_room_specs`, `apply_crop_environment`, `list_available_crops`, `get_crop_recipe_targets` (see `greenreach-central/routes/assistant-chat.js`)

## 6. Data flows

### 6.1 Happy path (active build)
```
 1. Operator enters location in farm-setup.html (existing geolocation UI)
 2. UI POST /api/farm-builder/design-conditions → caches designEnvelope on farm_profile
 3. Operator enters room dimensions + picks a template from grow-systems.json
 4. Operator picks crops (with tray counts) from list_available_crops
 5. UI POST /api/farm-builder/propose
      → Central buildFarmLayout_v2({ location, building, template, crops, designEnvelope })
      → returns { zones, lights, hvac, dehu, irrigation, controls, bom, env_targets }
 6. UI renders proposal cards; 3D viewer shows proposed zone outlines + equipment sprites as overlay
 7. Operator tweaks (e.g. swap fixture SKU, change tray count) or accepts
 8. POST /api/farm-builder/proposals/:id/accept
      → creates rooms / zones / groups
      → stamps groups[*].planConfig.template_id and anchor.seedDate (on first planting)
      → registers devices in device store (pending pairing)
 9. Setup-Agent phase graph advances; downstream phases render as "review accepted recommendation"
```

### 6.2 Operator override path
If the operator rejects the proposal, the wizard falls back to the passive flow (today's `farm-setup.html` enumeration UI). The `farm_proposals` record is retained with `status='rejected'` + reason for analytics.

### 6.3 Re-build path (existing farm)
Farm operator can re-run the builder from `farm-setup.html → Re-run Builder`. Inputs pre-fill from `farm_profile` + `rooms[*]`. The proposal is diffed against current rooms / groups / devices; the accept step offers "apply only adds", "apply all", or "cancel".

## 7. Security & tenancy

- All write paths (`/propose`, `/accept`, `/reject`) scope to the calling farm's `farmId` via `farm_store`.
- `farm_proposals` is a per-tenant store; proposals never leak across tenants.
- Design-conditions responses are cached per `(lat, lng)` at a coarse grid (~0.1°) globally; no tenant data in the cache key.
- Central-admin-only flag `platform.farm_builder.enabled` gates Phase B/C rollout.
- `accept` must require human confirmation (EVIE trust tier `confirm`, not `quick_confirm` — this writes equipment records).

## 8. Configuration

| Env var / flag | Purpose |
|---|---|
| `PLATFORM_FARM_BUILDER_ENABLED` | Master kill switch for `/api/farm-builder/*` |
| `DESIGN_CONDITIONS_PROVIDER` | `ashrae | nrel_tmy | lat_band_fallback` |
| `DESIGN_CONDITIONS_CACHE_TTL_HOURS` | Default 720 (30 days) |
| `FARM_BUILDER_RECENT_PROPOSAL_LIMIT` | UI cap; default 5 |

## 9. Canonical data shape for growing systems (proposed)

> **Status:** This is the **target** schema for `grow-systems.json` once the Farm Builder is fully active. Today's `grow-systems.json` already carries the fields marked **(present)**; fields marked **(Phase C)** are new and land with `buildFarmLayout_v2` so the builder can size HVAC/irrigation from the template alone. `equipment-db.js HYDRO_SYSTEM_DB` is derived from `grow-systems.json` at module load starting in **Phase C4**.

```jsonc
{
  // --- present in grow-systems.json today ---
  "id": "nft-rack-3tier",                        // (present)
  "name": "NFT Rack, 3-Tier",                    // (present)
  "category": "nft_rack",                         // (present)
  "suitableCropClasses": ["leafy_greens","herbs"], // (present)
  "footprintM": { "length": 2.4, "width": 0.6 },  // (present)
  "heightM": 2.4,                                  // (present)
  "tierCount": 3,                                  // (present)
  "traysPerTier": 10,                              // (present)
  "trayFormat": { "lengthIn": 24, "widthIn": 28, "plantsPerTrayDefault": 30 }, // (present)
  "plantsPerTrayByClass": { "leafy_greens": 30, "herbs": 15, "fruiting": 4, "microgreens": 200 }, // (present)
  "defaultFixtureClass": { "ppfdTargetByClass": {...}, "dliTargetByClass": {...}, "photoperiodHoursByClass": {...}, "efficacyUmolPerJ": 2.7, "fixtureWattsNominal": 100, "fixturesPerTierUnit": 2 }, // (present)
  "defaultControllerClass": { "lights": { "type": "0_10v" }, "pumps": {...}, "fans": {...}, "sensors": { "type": "switchbot_cloud" } }, // (present)
  "requiredChannels": [...],                       // (present)
  "powerClassW": 1200,                             // (present)
  "references": [...],                             // (present)

  // --- to be added in Phase C; needed for HVAC + irrigation sizing ---
  "irrigation": { "type": "nft", "supplyPumpWattsPer10kPlants": 300, "returnPumpWattsPer10kPlants": 150, "dutyCycle": 0.5, "reservoirGalPerPlant": 1.0, "plumbingCostPer10kPlantsUsd": 500 }, // (Phase C)
  "transpiration": { "gPerPlantPerDayByClass": { "leafy_greens": 30, "herbs": 25, "fruiting": 120, "microgreens": 8 }, "sensibleHeatFactor": 0.3 } // (Phase C)
}
```

## 10. Phased rollout

| Phase | Goal | PRs (indicative) | Risk | Depends on | Blast radius |
|---|---|---|---|---|---|
| **A** | Fix silent crop-scheduling break (pre-req for any active builder to be trustworthy) | A1 `stampPlanAnchor` helper + `update_group_crop` patch · A2 tray-inventory seeding hook · A3 opt-in startup migration | Low | — | EVIE-assigned / Activity-Hub-assigned groups (today: broken day-numbering) |
| **B** | Make the builder reachable from a UI | B1 `farm-setup.html` new `build` step · B2 3D-viewer proposal overlay | Low-Medium | existing `buildFarmLayout` v1 | New UI, no behavior change to existing groups |
| **C** | Active = location-aware | C1 `design-conditions.js` + `get_design_conditions` tool · C2 `buildFarmLayout_v2` with `designEnvelope` input · C3 farm-setup.html posts location+envelope · C4 auto-generate `HYDRO_SYSTEM_DB` from `grow-systems.json` | Medium | B, external design-conditions provider | HVAC sizing for new builds |
| **D** | Unified crop-scheduling store | D1 `/api/schedule/seedings` adapter · D2 planting-scheduler.html migration | Medium | A | Planning / tray-inventory / daily resolver read same source |
| **E** | Documentation + CI guardrails | E1 playbook updates · E2 mirror-drift CI check | Low | — | Docs + CI only |

Suggested order: **E1 → A → B → D → C → E2.**

## 11. Known gaps / open items (today, 2026-04-18)

1. `recommend_farm_layout` is wired to EVIE chat only; no UI entry point anywhere in `public/views/farm-setup.html` or `public/setup-wizard.html`.
2. `HYDRO_SYSTEM_DB` (equipment-db.js) and `grow-systems.json.templates` are two parallel schemas with different keys. `buildFarmLayout` reads only the former.
3. `buildFarmLayout` is location-agnostic: no ASHRAE / TMY design condition input → HVAC/dehumidification sizing is wrong outside moderate climates.
4. `update_group_crop` (assistant-chat.js:4918–4950) does not stamp `planConfig.anchor.seedDate` — EVIE-assigned groups do not progress through recipes. (Tracked in Phase A.)
5. `planting-scheduler.html` writes `planting_assignments` which the daily resolver does not read. (Tracked in Phase D.)
6. No `farm_proposals` store exists yet; current state is write-through to `rooms`/`groups`/`devices` with no audit trail for rejected proposals.
7. No mirror-drift CI guard exists for the dual-deploy registry; #9/#16/#17 drift went undetected until #37.

## 12. Never do

- Never accept a `farm-builder` proposal without an explicit operator confirmation step — this writes `rooms` / `groups` / `devices`, and automatic writes are the passive paradigm we are leaving behind.
- Never bypass `design-conditions.js` cache with direct external calls at request time (rate-limit + latency risk).
- Never embed farm-specific data (farmId, user, operator name) into the design-conditions cache key.
- Never regenerate `grow-systems.json` or `equipment-kb.json` automatically at runtime; they are curated KBs, edited via PR.
- Never let a UI write directly to `rooms` / `groups` outside the `accept` path **after the Phase B proposal/accept flow is migrated to production**. The current canonical crop-assignment UI (`public/views/3d-farm-viewer.html` `applyGroupEdits`, lines ~3679–3710) is the legitimate write path today; it migrates to issue a mini-proposal via `/api/farm-builder/propose` + `accept` in Phase B2. Until then, direct writes from the 3D viewer are **allowed and expected** — do not disable them prematurely.
- Never stamp `anchor.seedDate` from a system default in the crop-scheduling path without also raising an operator-visible alert that the date was auto-filled.

## 13. References

- `docs/playbooks/02-ai-agent-platform.md` §4 (trust tiers — `recommend_farm_layout` is `quick_confirm`; `accept` must be `confirm`)
- `docs/playbooks/07-farm-operations.md` §7 (tray lifecycle) and new §Crop scheduling contract
- `docs/playbooks/09-admin-platform-ops.md` §Setup-agent phase catalogue
- `docs/audits/FOXTROT_REAUDIT_2026-04-18.md` (this audit)
- `greenreach-central/lib/farm-builder.js`, `greenreach-central/lib/equipment-db.js`
- `greenreach-central/routes/setup-agent.js`, `greenreach-central/routes/assistant-chat.js`
