/**
 * Farm Builder -- "Build the Farm" orchestration layer.
 *
 * Takes room specs + crop selection, resolves environment targets from
 * lighting recipes, calculates equipment requirements via equipment-db,
 * and produces a complete farm layout recommendation.
 *
 * Design principle: target environment is determined by the crop selection
 * and crop recipes -- NOT manual user input. When a crop is assigned to a
 * zone/group, the recipe drives temperature, humidity, VPD, EC, pH targets.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  calculateRoomRequirements,
  calculateLightsNeeded,
  recommendFans,
  recommendDehumidifier,
  calculateCoolingRequirement,
  LIGHT_DB,
  HYDRO_SYSTEM_DB
} from './equipment-db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Recipe Loader ──────────────────────────────────────────────────────

let _recipeCache = null;

function loadRecipes() {
  if (_recipeCache) return _recipeCache;
  try {
    // Try Central public/data first, then root public/data
    const centralPath = path.join(__dirname, '..', 'public', 'data', 'lighting-recipes.json');
    const rootPath = path.join(__dirname, '..', '..', 'public', 'data', 'lighting-recipes.json');
    const recipePath = fs.existsSync(centralPath) ? centralPath : rootPath;
    const raw = fs.readFileSync(recipePath, 'utf8');
    _recipeCache = JSON.parse(raw);
    return _recipeCache;
  } catch (err) {
    console.error('[FarmBuilder] Failed to load recipes:', err.message);
    return { crops: {} };
  }
}

/**
 * Clear recipe cache (useful after recipe updates).
 */
export function clearRecipeCache() {
  _recipeCache = null;
}

// ── Recipe Target Resolution ───────────────────────────────────────────

/**
 * Get environment targets for a crop at a specific growth day.
 * Returns temperature, humidity, VPD, EC, pH, PPFD, DLI from the recipe.
 *
 * @param {string} cropName - Crop name as it appears in lighting-recipes.json
 * @param {number} day - Growth day (1-based). If omitted, returns targets for day 1.
 * @returns {{ ok: boolean, targets?: object, crop?: string, error?: string }}
 */
export function getCropTargets(cropName, day = 1) {
  const recipes = loadRecipes();
  const crops = recipes.crops || {};

  // Case-insensitive crop lookup
  const key = Object.keys(crops).find(k => k.toLowerCase() === cropName.toLowerCase());
  if (!key) {
    return { ok: false, error: `Crop "${cropName}" not found in recipe database. Available: ${Object.keys(crops).slice(0, 10).join(', ')}...` };
  }

  const schedule = crops[key].schedule;
  if (!schedule || schedule.length === 0) {
    return { ok: false, error: `Crop "${key}" has no schedule data` };
  }

  // Find the closest day entry (recipe days may be fractional)
  let entry = schedule[0];
  for (const e of schedule) {
    if (e.day <= day) entry = e;
    else break;
  }

  return {
    ok: true,
    crop: key,
    day: entry.day,
    stage: entry.stage,
    targets: {
      temperature_c: entry.temperature,
      max_humidity_pct: entry.max_humidity,
      vpd_kpa: entry.vpd,
      ec_ms_cm: entry.ec,
      ph: entry.ph,
      ppfd_umol: entry.ppfd,
      dli_mol: entry.dli
    },
    spectrum: {
      blue_pct: entry.blue,
      green_pct: entry.green,
      red_pct: entry.red,
      far_red_pct: entry.far_red
    }
  };
}

/**
 * Get environment target ranges for a crop across its full growth cycle.
 * Returns min/max for each parameter across all schedule entries.
 *
 * @param {string} cropName
 * @returns {{ ok: boolean, ranges?: object, stages?: object[], error?: string }}
 */
export function getCropTargetRanges(cropName) {
  const recipes = loadRecipes();
  const crops = recipes.crops || {};

  const key = Object.keys(crops).find(k => k.toLowerCase() === cropName.toLowerCase());
  if (!key) {
    return { ok: false, error: `Crop "${cropName}" not found in recipe database` };
  }

  const schedule = crops[key].schedule;
  if (!schedule || schedule.length === 0) {
    return { ok: false, error: `Crop "${key}" has no schedule data` };
  }

  const params = ['temperature', 'max_humidity', 'vpd', 'ec', 'ph', 'ppfd', 'dli'];
  const ranges = {};
  for (const p of params) {
    const values = schedule.map(e => e[p]).filter(v => v != null);
    if (values.length > 0) {
      ranges[p] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
      };
    }
  }

  // Summarize growth stages
  const stageMap = {};
  for (const e of schedule) {
    if (!stageMap[e.stage]) {
      stageMap[e.stage] = { stage: e.stage, day_start: e.day, day_end: e.day };
    }
    stageMap[e.stage].day_end = e.day;
  }

  return {
    ok: true,
    crop: key,
    total_days: schedule[schedule.length - 1].day,
    ranges,
    stages: Object.values(stageMap)
  };
}

/**
 * Derive zone target ranges from a crop recipe for use with update_target_ranges.
 * Returns the values needed by the environment control system.
 *
 * @param {string} cropName
 * @param {number} [day] - Optional growth day; if omitted, uses peak-stage averages
 * @returns {{ ok: boolean, zone_targets?: object, error?: string }}
 */
export function deriveZoneTargets(cropName, day) {
  if (day != null) {
    const result = getCropTargets(cropName, day);
    if (!result.ok) return result;
    const t = result.targets;
    return {
      ok: true,
      crop: result.crop,
      day: result.day,
      stage: result.stage,
      zone_targets: {
        temp_min: Math.round((t.temperature_c - 1) * 10) / 10,
        temp_max: Math.round((t.temperature_c + 2) * 10) / 10,
        rh_min: Math.max(30, Math.round(t.max_humidity_pct - 10)),
        rh_max: Math.round(t.max_humidity_pct),
        vpd_min: Math.round((t.vpd_kpa - 0.15) * 100) / 100,
        vpd_max: Math.round((t.vpd_kpa + 0.2) * 100) / 100,
        ec_target: t.ec_ms_cm,
        ph_target: t.ph,
        ppfd_target: Math.round(t.ppfd_umol)
      },
      source: 'crop_recipe'
    };
  }

  // No day specified: use ranges across the full cycle
  const result = getCropTargetRanges(cropName);
  if (!result.ok) return result;
  const r = result.ranges;
  return {
    ok: true,
    crop: result.crop,
    zone_targets: {
      temp_min: Math.round((r.temperature.min - 1) * 10) / 10,
      temp_max: Math.round((r.temperature.max + 2) * 10) / 10,
      rh_min: Math.max(30, Math.round(r.max_humidity.min - 10)),
      rh_max: Math.round(r.max_humidity.max),
      vpd_min: Math.round((r.vpd.min - 0.15) * 100) / 100,
      vpd_max: Math.round((r.vpd.max + 0.2) * 100) / 100,
      ec_target: r.ec.avg,
      ph_target: r.ph.avg,
      ppfd_target: Math.round(r.ppfd.avg)
    },
    stages: result.stages,
    source: 'crop_recipe_ranges'
  };
}

// ── Light Selection ────────────────────────────────────────────────────

/**
 * Choose the best light fixture for a crop based on PPFD requirements.
 *
 * @param {number} target_ppfd
 * @param {string[]} [crops] - Crop names to help narrow selection
 * @returns {string} light_id from LIGHT_DB
 */
function selectLightForCrop(target_ppfd, crops = []) {
  const cropLower = crops.map(c => c.toLowerCase());

  // Low-light crops (microgreens, seedlings): prefer small bars
  if (target_ppfd <= 150) return 'led-bar-40w';
  if (target_ppfd <= 250) return 'led-bar-80w';
  if (target_ppfd <= 400) return 'led-panel-200w';
  if (target_ppfd <= 700) return 'led-panel-400w';
  return 'led-panel-600w';
}

// ── Farm Layout Builder ────────────────────────────────────────────────

/**
 * Build a complete farm layout recommendation for a room.
 *
 * Takes room physical specs, crop selections, and hydroponic system type,
 * then calculates all equipment requirements.
 *
 * @param {object} params
 * @param {number} params.room_area_m2 - Room floor area in square meters
 * @param {number} params.ceiling_height_m - Ceiling height in meters
 * @param {string} [params.hydro_system] - Hydroponic system type from HYDRO_SYSTEM_DB
 * @param {string} [params.hvac_type] - 'mini_split' or 'portable' or 'central'
 * @param {string[]} [params.crops] - Array of crop names to grow
 * @param {number} [params.plant_count] - Estimated plant count (auto-calculated if omitted)
 * @returns {object} Complete layout recommendation
 */
export function buildFarmLayout(params) {
  const {
    room_area_m2,
    ceiling_height_m,
    hydro_system,
    hvac_type,
    crops = [],
    plant_count
  } = params;

  if (!room_area_m2 || !ceiling_height_m) {
    return { ok: false, error: 'room_area_m2 and ceiling_height_m are required' };
  }

  // 1. Resolve crop targets (use first crop for primary targets)
  let primary_targets = null;
  let crop_details = [];
  let max_ppfd = 300; // default fallback

  for (const cropName of crops) {
    const targets = deriveZoneTargets(cropName);
    if (targets.ok) {
      crop_details.push({
        crop: targets.crop,
        zone_targets: targets.zone_targets,
        stages: targets.stages
      });
      if (!primary_targets) primary_targets = targets;
      if (targets.zone_targets.ppfd_target > max_ppfd) {
        max_ppfd = targets.zone_targets.ppfd_target;
      }
    }
  }

  // 2. Select best light fixture for the required PPFD
  const light_id = selectLightForCrop(max_ppfd, crops);

  // 3. Estimate plant count from hydro system + area if not provided
  let estimated_plants = plant_count;
  if (!estimated_plants) {
    const hydro = hydro_system ? HYDRO_SYSTEM_DB[hydro_system] : null;
    if (hydro) {
      // Estimate usable area (70% of floor for growing, 30% for walkways)
      const usable_m2 = room_area_m2 * 0.7;
      const sites_per_m2 = hydro.type === 'vertical_tower' ? 40 : hydro.type === 'nft' ? 16 : hydro.type === 'dwc' ? 12 : 10;
      estimated_plants = Math.round(usable_m2 * sites_per_m2);
    } else {
      // Generic estimate: ~12 plants per m2 for leafy greens
      estimated_plants = Math.round(room_area_m2 * 0.7 * 12);
    }
  }

  // 4. Calculate all equipment requirements
  const requirements = calculateRoomRequirements({
    room_area_m2,
    ceiling_height_m,
    plant_count: estimated_plants,
    target_ppfd: max_ppfd,
    light_preference: light_id,
    hydro_system
  });

  // 5. Build placement recommendations
  const placements = buildPlacementGuide(params, requirements);

  // 6. Assemble the complete layout
  return {
    ok: true,
    room_specs: {
      area_m2: room_area_m2,
      ceiling_height_m,
      volume_m3: room_area_m2 * ceiling_height_m
    },
    crops: crop_details,
    environment_targets: primary_targets ? primary_targets.zone_targets : null,
    plant_estimate: estimated_plants,
    hydroponic_system: hydro_system ? {
      id: hydro_system,
      ...HYDRO_SYSTEM_DB[hydro_system]
    } : null,
    equipment: {
      lighting: requirements.lighting,
      fans: requirements.fans,
      dehumidification: requirements.dehumidification,
      cooling: requirements.cooling,
      hvac: requirements.hvac
    },
    total_estimated_wattage: requirements.total_estimated_wattage,
    placements,
    summary: buildSummaryText(params, requirements, crop_details, estimated_plants)
  };
}

// ── Placement Guide Builder ────────────────────────────────────────────

function buildPlacementGuide(params, requirements) {
  const { room_area_m2, ceiling_height_m } = params;
  const width_est = Math.sqrt(room_area_m2 * 1.5); // assume 3:2 aspect
  const length_est = room_area_m2 / width_est;

  const guide = [];

  // Lighting placement
  if (requirements.lighting?.ok) {
    const count = requirements.lighting.units_needed;
    const light = LIGHT_DB[requirements.lighting.light_id];
    const rows = Math.ceil(Math.sqrt(count * (length_est / width_est)));
    const cols = Math.ceil(count / rows);
    const row_spacing = (length_est / rows).toFixed(2);
    const col_spacing = (width_est / cols).toFixed(2);
    guide.push({
      category: 'lighting',
      equipment: light?.name || requirements.lighting.light_name,
      count,
      placement: `Mount ${count} fixtures in a ${rows}x${cols} grid pattern at canopy height + 30-50cm. Row spacing: ~${row_spacing}m, column spacing: ~${col_spacing}m. Center the grid in the growing area.`,
      height: `${(ceiling_height_m * 0.7).toFixed(1)}m from floor (adjust based on crop stage)`
    });
  }

  // Fan placement
  if (requirements.fans) {
    guide.push({
      category: 'exhaust',
      equipment: requirements.fans.exhaust.fan_name,
      count: requirements.fans.exhaust.count,
      placement: requirements.fans.exhaust.placement
    });
    guide.push({
      category: 'circulation',
      equipment: requirements.fans.circulation.fan_name,
      count: requirements.fans.circulation.count,
      placement: requirements.fans.circulation.placement
    });
  }

  // Dehumidifier placement
  if (requirements.dehumidification) {
    guide.push({
      category: 'dehumidification',
      equipment: requirements.dehumidification.dehu_name,
      count: requirements.dehumidification.count,
      placement: requirements.dehumidification.placement
    });
  }

  // HVAC placement
  if (requirements.hvac) {
    guide.push({
      category: 'hvac',
      equipment: requirements.hvac.name,
      count: 1,
      placement: 'Mount indoor unit high on wall, centered along the longest wall. Aim airflow across the room, not directly at plant canopy. Outdoor unit requires ventilated exterior access.'
    });
  }

  return guide;
}

// ── Summary Text Builder ───────────────────────────────────────────────

function buildSummaryText(params, requirements, crop_details, plant_count) {
  const lines = [];
  const area = params.room_area_m2;
  const height = params.ceiling_height_m;

  lines.push(`Room: ${area}m2 floor area, ${height}m ceiling (${(area * height).toFixed(1)}m3 volume).`);

  if (crop_details.length > 0) {
    lines.push(`Crops: ${crop_details.map(c => c.crop).join(', ')}.`);
  }
  if (params.hydro_system && HYDRO_SYSTEM_DB[params.hydro_system]) {
    lines.push(`Hydroponic system: ${HYDRO_SYSTEM_DB[params.hydro_system].name}.`);
  }
  lines.push(`Estimated plant count: ${plant_count}.`);

  if (requirements.lighting?.ok) {
    lines.push(`Lighting: ${requirements.lighting.units_needed}x ${requirements.lighting.light_name} (${requirements.lighting.achieved_ppfd} PPFD, ${requirements.lighting.total_wattage}W total).`);
  }
  if (requirements.fans) {
    lines.push(`Ventilation: ${requirements.fans.exhaust.count}x ${requirements.fans.exhaust.fan_name} (exhaust) + ${requirements.fans.circulation.count}x ${requirements.fans.circulation.fan_name} (circulation).`);
  }
  if (requirements.dehumidification) {
    lines.push(`Dehumidification: ${requirements.dehumidification.count}x ${requirements.dehumidification.dehu_name} (${requirements.dehumidification.capacity_pints_day} pint/day capacity).`);
  }
  if (requirements.hvac) {
    lines.push(`Climate control: ${requirements.hvac.name} (${requirements.hvac.cooling_btu} BTU cooling).`);
  }
  lines.push(`Total estimated power draw: ${requirements.total_estimated_wattage}W.`);

  return lines.join(' ');
}

// ── List Available Crops ───────────────────────────────────────────────

/**
 * List all crops available in the recipe database.
 * @returns {{ ok: boolean, crops: string[], count: number }}
 */
export function listAvailableCrops() {
  const recipes = loadRecipes();
  const names = Object.keys(recipes.crops || {});
  return { ok: true, crops: names, count: names.length };
}

export default {
  getCropTargets,
  getCropTargetRanges,
  deriveZoneTargets,
  buildFarmLayout,
  listAvailableCrops,
  clearRecipeCache
};
