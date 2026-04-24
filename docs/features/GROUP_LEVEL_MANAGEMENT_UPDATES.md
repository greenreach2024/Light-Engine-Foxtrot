# Group-Level Management Updates

**Date:** April 24, 2026
**Status:** Proposed (driven by farm user feedback)
**Supersedes (scope):** Tray-first operational flow described in
  `docs/features/ACTIVITY_HUB_ARCHITECTURE.md`,
  `docs/features/GROUP_V2_WORKFLOW_REVIEW.md`,
  `docs/features/RECIPE_BASED_ENVIRONMENTAL_CONTROL.md`,
  `docs/features/NUTRIENT_MANAGEMENT_READINESS_REPORT.md`,
  `docs/features/INVENTORY_DATA_FLOW.md`,
  `docs/ai-agents/EVIE_SCANNING_INTEGRATION_IMPLEMENTATION_TODO_2026-03-28.md`,
  `docs/TRAY_TRACKING_ENHANCEMENTS.md`,
  `docs/features/TRAY_ENHANCEMENTS_QUICKSTART.md`,
  `docs/archive/readiness-reports/TRAY_SETUP_READINESS_REPORT.md`,
  `docs/archive/readiness-reports/GROUPS_V2_READINESS_REPORT.md`.

---

## 1. Motivation

Farms running at scale reported that scanning and updating **every individual
tray** for seed, placement, transfer, photo, and harvest events is too
time-consuming. The original flow was built around Groups v2 as a
logical container with per-tray operations handled through the Activity
Hub. Feedback requires us to invert that: the **group** is the primary
unit of management, the tray is a derived record used only when
per-tray provenance is explicitly needed.

## 2. Principles

1. **Group is the source of truth** for crop recipe, seed date, target
   zone, plant count, fixtures, tank, schedule, and environmental
   overrides.
2. **Trays are derived by default** from the group configuration
   (`count x tray_format`). They retain QR codes for audit, lot
   traceability, and harvest splits, but are not required for daily
   operations.
3. **Templates are a starting point, not a lock.** A template provides
   sensible defaults; a tailoring form lets the user override the
   fields that vary per planting.
4. **Recipe lineage must be preserved.** If the user overrides a
   parameter, the group stores both the source recipe id and the
   override so reports can show deviation.
5. **No new scan is ever required to start, maintain, or harvest a
   group.** Scans remain optional and are used for:
   - Lot splitting at harvest (per-tray yield).
   - QA photo capture tied to a physical tray.
   - Reassigning a tray to a different group mid-cycle.

## 3. Data Model Changes

### 3.1 `groups.json` additions

Add the following fields to each group record. Existing fields are
preserved.

```json
{
  "id": "ROOM-A-Z1-G01",
  "name": "Butterhead Lettuce Rack 1",
  "zoneId": "ROOM-A-Z1",
  "roomId": "ROOM-A",

  "templateId": "leafy-greens-default",
  "templateVersion": "1.0.0",

  "crop": "Butterhead Lettuce",
  "planId": "buttercrunch-lettuce-(21-day)",
  "planSource": "recipe-v2",

  "trayFormatId": "rack-1020-50-site",
  "trayCount": 8,
  "plantsPerSite": 1,
  "plants": 400,

  "fixtures": ["ROOM-A-Z1-G01-LIGHT"],
  "tankId": "tank-2",

  "anchor": {
    "mode": "seedDate",
    "seedDate": "2026-04-01T00:00:00.000Z"
  },

  "schedule": {
    "photoperiodHours": 16,
    "rampUpMin": 10,
    "rampDownMin": 10,
    "cycles": [{ "start": "08:00", "off": "00:00", "photo": 16 }]
  },

  "overrides": {
    "environment": {
      "vpd_target": null,
      "temp_target": null,
      "max_humidity": 70
    },
    "nutrient": {
      "ec_target": null,
      "ph_target": null
    }
  },

  "status": "active",
  "health": "healthy"
}
```

Notes:
- `plants = trayCount * trayFormat.plantSiteCount * plantsPerSite`.
- `overrides.*.<field> = null` means "use recipe value for current day".
- `templateId` is informational after creation; edits update the group
  directly, they do not re-apply the template.

### 3.2 Template catalog (`data/group-templates.json`)

```json
{
  "schemaVersion": "1.0.0",
  "templates": [
    {
      "id": "leafy-greens-default",
      "name": "Leafy Greens (default)",
      "category": "Leafy Greens",
      "defaults": {
        "planId": "buttercrunch-lettuce-(21-day)",
        "trayFormatId": "rack-1020-50-site",
        "trayCount": 8,
        "plantsPerSite": 1,
        "photoperiodHours": 16,
        "tankId": "tank-2"
      },
      "userInputs": [
        { "field": "name", "label": "Group name", "required": true },
        { "field": "zoneId", "label": "Zone", "required": true, "source": "rooms" },
        { "field": "planId", "label": "Recipe", "required": true, "source": "recipes" },
        { "field": "trayCount", "label": "Tray count", "type": "int", "min": 1 },
        { "field": "trayFormatId", "label": "Tray format", "source": "tray-formats" },
        { "field": "plantsPerSite", "label": "Plants per site", "type": "int", "default": 1 },
        { "field": "anchor.seedDate", "label": "Seed date", "type": "date", "required": true },
        { "field": "tankId", "label": "Nutrient tank", "source": "tanks" },
        { "field": "schedule.photoperiodHours", "label": "Photoperiod", "type": "int", "min": 0, "max": 24 }
      ]
    }
  ]
}
```

Initial catalog covers Leafy Greens, Herbs, Fruiting Crops
(mirrors `RECIPES_V2_MIGRATION_COMPLETE.md` categories). Templates
stay editable by admins; changing a template does not retroactively
update existing groups.

### 3.3 `tray_runs` behavior

`tray_runs` rows are still created, now **implicitly** when a group is
saved with `trayCount > 0`. Each run is stamped with:

- `group_id` (new foreign key, required)
- `recipe_id` inherited from `group.planId`
- `seed_date` inherited from `group.anchor.seedDate`
- `planted_site_count` inherited from `tray_format.plantSiteCount * plantsPerSite`

Per-tray fields are only updated when a user performs an optional
scan (photo, transfer, split harvest).

## 4. Workflow Updates

### 4.1 Group creation

1. User picks a **template**. System pre-fills defaults.
2. User completes the **tailoring form** (the `userInputs` above).
3. User saves the group. Backend:
   - Writes group to `groups.json`.
   - Creates `trayCount` implicit `tray_runs` with shared anchor.
   - Upserts the lighting schedule (already supported in
     `groups-v2.js:upsertGroupScheduleForGroup`).
   - Registers the group with the nutrient controller for the chosen
     tank.

### 4.2 Environment management (replaces
  `RECIPE_BASED_ENVIRONMENTAL_CONTROL.md` Section "How It Works")

Targets are resolved at the group level, then aggregated up to the
zone when multiple groups share a zone.

```
for each group g active in zone z:
  day    = floor((now - g.anchor.seedDate) / 24h) + 1
  sched  = recipe(g.planId).schedule at day
  vpd    = g.overrides.environment.vpd_target   ?? sched.vpd_target
  temp   = g.overrides.environment.temp_target  ?? sched.temp_target
  maxRh  = g.overrides.environment.max_humidity ?? sched.max_humidity
  weight = g.plants

zone.vpd    = sum(vpd  * weight) / sum(weight)
zone.temp   = sum(temp * weight) / sum(weight)
zone.maxRh  = min(maxRh)
```

The per-tray aggregation in `RecipeEnvironmentalTargets` is replaced
by a per-group aggregation. When no groups are active in a zone, the
existing `GrowthStageManager` fallback remains.

### 4.3 Nutrient management (replaces
  `NUTRIENT_MANAGEMENT_READINESS_REPORT.md` Section 4 "Autodose
  Configuration Panel" stage-aware logic)

Stage is derived from `group.anchor` and `recipe.data.schedule`, not
from tray age. If a tank serves multiple groups:

- EC/pH targets are the plant-count weighted average of the
  groups' current schedule values.
- Autodose still respects the most restrictive safety limits across
  groups (same policy as max-RH).
- Tank assignment is required on every group (was previously
  recommended).

Per-group overrides (`overrides.nutrient.ec_target`,
`overrides.nutrient.ph_target`) let one farm deviate from the recipe
without forking the recipe.

### 4.4 Schedules

No data shape change. The schedule already lives on the group
(`schedules[].groupId`). Documentation is updated to make this the
sole ownership point; per-tray schedules are removed from the UI.

### 4.5 Inventory / Harvest (replaces tray-first flow in
  `TRAY_TRACKING_ENHANCEMENTS.md` Section 3 "Batch Harvest" and
  `INVENTORY_DATA_FLOW.md` Section 5)

Primary action is **Record Group Harvest**:

```
POST /api/groups/:groupId/harvest
{
  "totalWeight": 12.4,
  "unit": "kg",
  "splitMode": "even",        // or "per-tray"
  "perTray": [                // required only if splitMode = "per-tray"
    { "trayId": "FARM-TRAY-0001", "weight": 1.5 },
    ...
  ],
  "lotCode": null             // server generates if null
}
```

Behavior:
- Creates one lot (default) or one lot per tray (split mode).
- Closes the group (`status: "harvested"`) unless the user chooses
  "partial harvest", in which case the group remains active with
  `plants` and tray count reduced.
- Publishes inventory to `crops` and syncs to Central via the
  existing `lib/sync-service.js` pipeline.
- The batch-harvest UI in Activity Hub is repositioned as a
  per-tray split tool inside the group harvest modal.

### 4.6 Activity Hub UI

- Default landing view becomes **Group Cards**, not the tray grid.
- Each group card shows: name, zone, crop, day, stage, days to
  harvest, plant count, environmental status, tank, next task.
- Tap a group card to open group detail (recipe preview, override
  form, schedule, assigned fixtures, tank).
- Tray grid is accessible from the group detail for QA photos,
  split harvest, or transfer.
- Existing QR scan is retained behind a **Scan** button; the default
  flow no longer prompts for a scan.

### 4.7 EVIE usage

Add group-first verbs and demote scan-per-tray as the primary path.
Aligns with `EVIE_SCANNING_INTEGRATION_IMPLEMENTATION_TODO_2026-03-28.md`
but shifts emphasis:

| Intent | Tool | Confirmation |
|---|---|---|
| Start a new planting | `create_group_from_template` | Confirm |
| Change photoperiod or override target | `update_group_overrides` | Confirm |
| Move fixtures or tank | `reassign_group_devices` | Confirm |
| Record harvest | `record_group_harvest` | Confirm |
| Repeat a planting | `repeat_group` (existing) | Confirm |
| Optional per-tray ops | `scan_tray`, `split_harvest_by_tray` | Confirm |

Scanning tools remain available but are no longer required for the
onboarding or daily-ops flows described in sections 4 and 5 of the
original scanning plan.

## 5. Migration Plan

1. **Schema migration**
   - Add `group_id` column to `tray_runs` (nullable first, backfill
     from current zone + recipe match, then make required).
   - Add `templateId`, `trayCount`, `trayFormatId`, `plantsPerSite`,
     `tankId`, `overrides` to `groups.json` (NeDB + persisted
     JSON).
2. **Template seeding**
   - Ship 3 starter templates: Leafy Greens, Herbs, Fruiting Crops.
   - Farms can clone and tailor.
3. **UI updates (behind flag `groupFirstOps`)**
   - New group creation wizard with template picker.
   - Group-first Activity Hub home view.
   - Group harvest modal.
4. **Automation updates**
   - Switch `RecipeEnvironmentalTargets` aggregation from trays to
     groups.
   - Switch nutrient stage detection to group anchor.
5. **EVIE updates**
   - Add the new tools in section 4.7.
   - Update `assistant-chat` system prompt to prefer group verbs.
6. **Deprecations (after 2 release cycles)**
   - Remove per-tray recipe assignment UI.
   - Remove per-tray schedule linking UI.
   - Tray-scan-required prompts in setup wizard.

## 6. Open Questions

- Should templates be farm-scoped or global with farm-level
  overrides? Current proposal: global catalog, farm clones saved as
  `custom-*` template ids.
- How should partial harvest reduce `plants` when `splitMode = "even"`?
  Proposed: reduce proportionally to weight, flag on the group if
  the reduction exceeds 25% in one event.
- Do we keep the Activity Hub edge-only rule from
  `ACTIVITY_HUB_ARCHITECTURE.md` as the farm moves to a cloud-only
  runtime? Proposed: yes -- Activity Hub now runs on LE Cloud Run
  (the cloud farm runtime), not on a device, but remains served from
  LE, not Central.

## 7. Acceptance Criteria

- Creating a group from a template produces a working planting with
  zero tray scans.
- Zone environmental targets update correctly with multiple groups
  of different recipes in the same zone.
- Autodose continues within safe limits when tank serves multiple
  groups with different EC/pH targets.
- Harvest recorded at group level writes inventory and syncs to
  Central without requiring individual tray scans.
- EVIE can complete create, override, harvest, and repeat flows
  without invoking scan tools.
- Scanning tools still work for split harvest and QA photos.
