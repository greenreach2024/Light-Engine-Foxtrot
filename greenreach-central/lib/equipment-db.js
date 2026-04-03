/**
 * Equipment Database -- Manufacturer reference data for CEA equipment.
 *
 * Provides lookup tables for lights, fans, dehumidifiers, HVAC units,
 * and hydroponic systems with performance specs that EVIE and GWEN use
 * to calculate requirements and recommend placement.
 *
 * Data sources: manufacturer datasheets, ASHRAE fundamentals,
 * Cornell CEA guidelines, and peer-reviewed indoor-ag literature.
 */

// ── Lighting Fixtures ──────────────────────────────────────────────────

export const LIGHT_DB = {
  'led-bar-40w': {
    name: 'LED Bar 40W',
    type: 'led',
    wattage: 40,
    ppf_umol_s: 108,
    efficacy_umol_j: 2.7,
    coverage_m2: 0.37,  // ~2ft x 2ft
    heat_output_btu_hr: 136,
    spectrum: 'full',
    mounting: 'bar',
    dimmable: true,
    voltage: '120V',
    lifespan_hours: 50000,
    suitable_for: ['microgreens', 'lettuce', 'herbs']
  },
  'led-bar-80w': {
    name: 'LED Bar 80W',
    type: 'led',
    wattage: 80,
    ppf_umol_s: 216,
    efficacy_umol_j: 2.7,
    coverage_m2: 0.74,
    heat_output_btu_hr: 273,
    spectrum: 'full',
    mounting: 'bar',
    dimmable: true,
    voltage: '120V',
    lifespan_hours: 50000,
    suitable_for: ['lettuce', 'herbs', 'greens']
  },
  'led-panel-200w': {
    name: 'LED Panel 200W',
    type: 'led',
    wattage: 200,
    ppf_umol_s: 540,
    efficacy_umol_j: 2.7,
    coverage_m2: 1.0,
    heat_output_btu_hr: 682,
    spectrum: 'full',
    mounting: 'panel',
    dimmable: true,
    voltage: '120-277V',
    lifespan_hours: 50000,
    suitable_for: ['lettuce', 'herbs', 'peppers', 'tomatoes']
  },
  'led-panel-400w': {
    name: 'LED Panel 400W',
    type: 'led',
    wattage: 400,
    ppf_umol_s: 1080,
    efficacy_umol_j: 2.7,
    coverage_m2: 1.5,
    heat_output_btu_hr: 1365,
    spectrum: 'full',
    mounting: 'panel',
    dimmable: true,
    voltage: '120-277V',
    lifespan_hours: 50000,
    suitable_for: ['tomatoes', 'peppers', 'cannabis', 'strawberries']
  },
  'led-panel-600w': {
    name: 'LED Panel 600W',
    type: 'led',
    wattage: 600,
    ppf_umol_s: 1620,
    efficacy_umol_j: 2.7,
    coverage_m2: 2.0,
    heat_output_btu_hr: 2047,
    spectrum: 'full',
    mounting: 'panel',
    dimmable: true,
    voltage: '120-277V',
    lifespan_hours: 50000,
    suitable_for: ['tomatoes', 'peppers', 'cannabis', 'strawberries']
  },
  't5-fluorescent-54w': {
    name: 'T5 Fluorescent 54W (4ft tube)',
    type: 'fluorescent',
    wattage: 54,
    ppf_umol_s: 86,
    efficacy_umol_j: 1.6,
    coverage_m2: 0.37,
    heat_output_btu_hr: 184,
    spectrum: '6500K',
    mounting: 'fixture',
    dimmable: false,
    voltage: '120V',
    lifespan_hours: 20000,
    suitable_for: ['seedlings', 'microgreens', 'propagation']
  }
};

// ── Fans ───────────────────────────────────────────────────────────────

export const FAN_DB = {
  'circulation-fan-6in': {
    name: '6" Clip/Wall Circulation Fan',
    type: 'circulation',
    cfm: 120,
    wattage: 20,
    coverage_m2: 6,
    noise_db: 40,
    mounting: 'clip/wall',
    oscillating: true,
    speeds: 2
  },
  'circulation-fan-12in': {
    name: '12" Wall-Mount Circulation Fan',
    type: 'circulation',
    cfm: 450,
    wattage: 55,
    coverage_m2: 15,
    noise_db: 50,
    mounting: 'wall',
    oscillating: true,
    speeds: 3
  },
  'inline-fan-4in': {
    name: '4" Inline Duct Fan',
    type: 'exhaust',
    cfm: 200,
    wattage: 28,
    coverage_m2: 8,
    noise_db: 32,
    mounting: 'duct',
    speed_control: true
  },
  'inline-fan-6in': {
    name: '6" Inline Duct Fan',
    type: 'exhaust',
    cfm: 400,
    wattage: 45,
    coverage_m2: 20,
    noise_db: 38,
    mounting: 'duct',
    speed_control: true
  },
  'inline-fan-8in': {
    name: '8" Inline Duct Fan',
    type: 'exhaust',
    cfm: 740,
    wattage: 75,
    coverage_m2: 35,
    noise_db: 42,
    mounting: 'duct',
    speed_control: true
  }
};

// ── Dehumidifiers ──────────────────────────────────────────────────────

export const DEHUMIDIFIER_DB = {
  'dehu-30pt': {
    name: '30-Pint Residential Dehumidifier',
    type: 'compressor',
    capacity_pints_day: 30,
    coverage_m2: 20,
    wattage: 350,
    operating_temp_c: [5, 35],
    noise_db: 50,
    drain: 'gravity/pump',
    suitable_for: ['small_room']
  },
  'dehu-50pt': {
    name: '50-Pint Dehumidifier',
    type: 'compressor',
    capacity_pints_day: 50,
    coverage_m2: 40,
    wattage: 550,
    operating_temp_c: [5, 35],
    noise_db: 52,
    drain: 'gravity/pump',
    suitable_for: ['medium_room']
  },
  'dehu-90pt': {
    name: '90-Pint Commercial Dehumidifier',
    type: 'compressor',
    capacity_pints_day: 90,
    coverage_m2: 70,
    wattage: 800,
    operating_temp_c: [5, 35],
    noise_db: 56,
    drain: 'gravity/pump',
    suitable_for: ['large_room']
  },
  'dehu-155pt-commercial': {
    name: '155-Pint Commercial Dehumidifier',
    type: 'compressor',
    capacity_pints_day: 155,
    coverage_m2: 120,
    wattage: 1200,
    operating_temp_c: [1, 40],
    noise_db: 60,
    drain: 'gravity',
    suitable_for: ['large_room', 'commercial']
  }
};

// ── HVAC / Climate ─────────────────────────────────────────────────────

export const HVAC_DB = {
  'mini-split-9k': {
    name: '9,000 BTU Mini-Split',
    type: 'mini_split',
    cooling_btu: 9000,
    heating_btu: 9000,
    coverage_m2: 20,
    wattage_cooling: 800,
    wattage_heating: 900,
    seer: 20,
    operating_temp_c: [-15, 48],
    refrigerant: 'R-410A'
  },
  'mini-split-12k': {
    name: '12,000 BTU Mini-Split (1 ton)',
    type: 'mini_split',
    cooling_btu: 12000,
    heating_btu: 12000,
    coverage_m2: 30,
    wattage_cooling: 1050,
    wattage_heating: 1150,
    seer: 20,
    operating_temp_c: [-15, 48],
    refrigerant: 'R-410A'
  },
  'mini-split-18k': {
    name: '18,000 BTU Mini-Split (1.5 ton)',
    type: 'mini_split',
    cooling_btu: 18000,
    heating_btu: 18000,
    coverage_m2: 45,
    wattage_cooling: 1550,
    wattage_heating: 1700,
    seer: 19,
    operating_temp_c: [-15, 48],
    refrigerant: 'R-410A'
  },
  'portable-ac-8k': {
    name: '8,000 BTU Portable AC',
    type: 'portable',
    cooling_btu: 8000,
    heating_btu: 0,
    coverage_m2: 15,
    wattage_cooling: 900,
    seer: 10,
    operating_temp_c: [5, 40],
    drain: 'tank/hose'
  }
};

// ── Hydroponic Systems ─────────────────────────────────────────────────

export const HYDRO_SYSTEM_DB = {
  'nft': {
    name: 'Nutrient Film Technique (NFT)',
    type: 'nft',
    description: 'Thin film of nutrient solution flows through sloped channels. Low water usage, fast growth.',
    tray_capacity_per_channel: 12,
    water_usage_l_day_per_site: 0.5,
    suitable_crops: ['lettuce', 'herbs', 'greens', 'strawberries'],
    requires_pump: true,
    requires_timer: false,
    flow_rate_lpm: '1-2',
    slope_pct: '1-3',
    reservoir_l_per_channel: 15,
    maintenance: 'Clean channels weekly; check roots for blocking'
  },
  'dwc': {
    name: 'Deep Water Culture (DWC / Raft)',
    type: 'dwc',
    description: 'Plants float on rafts in aerated nutrient solution. Simple, forgiving, good for beginners.',
    tray_capacity_per_raft: 24,
    water_usage_l_day_per_site: 0.8,
    suitable_crops: ['lettuce', 'herbs', 'greens', 'basil'],
    requires_pump: false,
    requires_air_pump: true,
    reservoir_depth_cm: 20,
    reservoir_l_per_raft: 60,
    maintenance: 'Monitor dissolved oxygen; clean rafts between cycles'
  },
  'ebb_flow': {
    name: 'Ebb & Flow (Flood & Drain)',
    type: 'ebb_flow',
    description: 'Tray floods periodically then drains. Versatile, works with many media.',
    tray_capacity_per_table: 50,
    water_usage_l_day_per_site: 0.6,
    suitable_crops: ['herbs', 'greens', 'peppers', 'tomatoes', 'microgreens'],
    requires_pump: true,
    requires_timer: true,
    flood_cycles_per_day: '4-8',
    reservoir_l_per_table: 40,
    maintenance: 'Clean trays between cycles; check drain valves'
  },
  'dutch_bucket': {
    name: 'Dutch Bucket',
    type: 'dutch_bucket',
    description: 'Individual buckets with drip irrigation. Best for fruiting crops.',
    tray_capacity_per_bucket: 1,
    water_usage_l_day_per_site: 2.5,
    suitable_crops: ['tomatoes', 'peppers', 'cucumbers', 'eggplant'],
    requires_pump: true,
    requires_timer: true,
    drip_cycles_per_day: '6-12',
    reservoir_l_per_10_buckets: 80,
    maintenance: 'Clean drip emitters regularly; replace media per cycle'
  },
  'vertical_tower': {
    name: 'Vertical Tower / ZipGrow',
    type: 'vertical_tower',
    description: 'Vertical growing columns with drip-down nutrient flow. High density per sq ft.',
    sites_per_tower: 28,
    water_usage_l_day_per_site: 0.4,
    suitable_crops: ['lettuce', 'herbs', 'greens', 'strawberries'],
    requires_pump: true,
    requires_timer: false,
    tower_height_m: 1.5,
    tower_spacing_m: 0.25,
    reservoir_l_per_row: 30,
    maintenance: 'Flush towers weekly; trim roots if blocking'
  },
  'aeroponics': {
    name: 'Aeroponics',
    type: 'aeroponics',
    description: 'Roots suspended in air; misted with nutrient solution. Maximum oxygenation.',
    sites_per_chamber: 36,
    water_usage_l_day_per_site: 0.3,
    suitable_crops: ['lettuce', 'herbs', 'greens', 'strawberries'],
    requires_pump: true,
    requires_timer: true,
    mist_interval_sec: '5-15 on / 60-120 off',
    reservoir_l_per_chamber: 25,
    maintenance: 'Clean mist nozzles frequently; backup pump mandatory'
  },
  'wicking': {
    name: 'Wicking System',
    type: 'wicking',
    description: 'Passive system using capillary action. Low-tech and low-cost. Best for small-scale.',
    sites_per_tray: 12,
    water_usage_l_day_per_site: 0.3,
    suitable_crops: ['herbs', 'microgreens', 'lettuce'],
    requires_pump: false,
    requires_timer: false,
    reservoir_l_per_tray: 10,
    maintenance: 'Minimal; replace wicks if saturated'
  }
};

// ── Calculation Helpers ────────────────────────────────────────────────

/**
 * Calculate required air exchanges per hour for a room.
 * Indoor CEA standard: 1-3 ACH for sealed rooms, higher for open.
 */
export function calculateAirExchanges(volume_m3, target_ach = 2) {
  const cfm_needed = (volume_m3 * 35.3147 * target_ach) / 60;
  return { cfm_needed: Math.round(cfm_needed), ach: target_ach, volume_m3 };
}

/**
 * Calculate total heat load from lighting in BTU/hr.
 */
export function calculateLightHeatLoad(light_id, count) {
  const light = LIGHT_DB[light_id];
  if (!light) return { ok: false, error: `Unknown light: ${light_id}` };
  return {
    ok: true,
    total_btu_hr: Math.round(light.heat_output_btu_hr * count),
    total_wattage: light.wattage * count,
    per_unit_btu_hr: light.heat_output_btu_hr
  };
}

/**
 * Calculate cooling requirement to offset lighting heat.
 * Returns BTU needed, adding 20% safety margin for insulation losses.
 */
export function calculateCoolingRequirement(light_heat_btu, room_area_m2, ceiling_height_m, insulation_factor = 1.2) {
  const volume_m3 = room_area_m2 * ceiling_height_m;
  // Envelope heat gain estimate: 10 BTU/hr per m2 for insulated interior spaces
  const envelope_gain = room_area_m2 * 10;
  const total_heat = (light_heat_btu + envelope_gain) * insulation_factor;
  return {
    total_cooling_btu: Math.round(total_heat),
    light_heat_btu: Math.round(light_heat_btu),
    envelope_gain_btu: Math.round(envelope_gain),
    safety_factor: insulation_factor,
    tons_cooling: +(total_heat / 12000).toFixed(2)
  };
}

/**
 * Calculate dehumidification requirement.
 * Plants transpire ~90-95% of water absorbed. Rough: 0.5-1L per plant per day.
 * 1 pint = 0.473 L
 */
export function calculateDehumidification(plant_count, transpiration_l_per_plant_day = 0.5) {
  const total_l_day = plant_count * transpiration_l_per_plant_day;
  const total_pints_day = total_l_day / 0.473;
  return {
    total_pints_day: Math.round(total_pints_day),
    total_l_day: Math.round(total_l_day),
    plant_count,
    transpiration_rate: transpiration_l_per_plant_day
  };
}

/**
 * Calculate number of lights needed for a target PPFD across a given area.
 */
export function calculateLightsNeeded(light_id, target_ppfd, area_m2) {
  const light = LIGHT_DB[light_id];
  if (!light) return { ok: false, error: `Unknown light: ${light_id}` };
  // PPFD at canopy ~ PPF / coverage_area (simplified uniform distribution)
  const ppfd_per_unit = light.ppf_umol_s / light.coverage_m2;
  const units_for_area = Math.ceil(area_m2 / light.coverage_m2);
  const units_for_ppfd = Math.ceil(target_ppfd / ppfd_per_unit * (area_m2 / light.coverage_m2));
  const units_needed = Math.max(units_for_area, units_for_ppfd);
  const achieved_ppfd = Math.round((units_needed * light.ppf_umol_s) / area_m2);
  return {
    ok: true,
    light_id,
    light_name: light.name,
    units_needed,
    achieved_ppfd,
    target_ppfd,
    total_wattage: units_needed * light.wattage,
    total_heat_btu_hr: Math.round(units_needed * light.heat_output_btu_hr),
    area_m2
  };
}

/**
 * Recommend fan configuration for a room.
 */
export function recommendFans(room_area_m2, ceiling_height_m) {
  const volume_m3 = room_area_m2 * ceiling_height_m;
  const volume_cf = volume_m3 * 35.3147;

  // Exhaust: 2 ACH minimum for sealed grow rooms
  const exhaust_cfm = Math.round((volume_cf * 2) / 60);

  // Circulation: 1 CFM per sq ft of floor area (industry standard)
  const circ_cfm = Math.round(room_area_m2 * 10.764);

  // Pick exhaust fan
  let exhaust_fan = 'inline-fan-4in';
  if (exhaust_cfm > 300) exhaust_fan = 'inline-fan-6in';
  if (exhaust_cfm > 600) exhaust_fan = 'inline-fan-8in';

  const exhaust_unit = FAN_DB[exhaust_fan];
  const exhaust_count = Math.ceil(exhaust_cfm / exhaust_unit.cfm);

  // Pick circulation fans
  let circ_fan = 'circulation-fan-6in';
  if (room_area_m2 > 10) circ_fan = 'circulation-fan-12in';
  const circ_unit = FAN_DB[circ_fan];
  const circ_count = Math.ceil(circ_cfm / circ_unit.cfm);

  return {
    exhaust: {
      fan_id: exhaust_fan,
      fan_name: exhaust_unit.name,
      count: exhaust_count,
      total_cfm: exhaust_count * exhaust_unit.cfm,
      required_cfm: exhaust_cfm,
      placement: 'Mount high on wall opposite intake. Duct to exterior or adjacent space.'
    },
    circulation: {
      fan_id: circ_fan,
      fan_name: circ_unit.name,
      count: circ_count,
      total_cfm: circ_count * circ_unit.cfm,
      required_cfm: circ_cfm,
      placement: 'Distribute evenly above canopy height. Aim airflow across plant canopy, not directly at plants.'
    },
    room_volume_m3: volume_m3
  };
}

/**
 * Recommend dehumidifier for a given plant count.
 */
export function recommendDehumidifier(plant_count, transpiration_rate = 0.5) {
  const { total_pints_day } = calculateDehumidification(plant_count, transpiration_rate);

  // Pick smallest unit that covers the load with 20% headroom
  const target = total_pints_day * 1.2;
  const sorted = Object.entries(DEHUMIDIFIER_DB).sort((a, b) =>
    a[1].capacity_pints_day - b[1].capacity_pints_day
  );

  let best = sorted[sorted.length - 1]; // fallback to largest
  let count = 1;
  for (const [id, spec] of sorted) {
    if (spec.capacity_pints_day >= target) {
      best = [id, spec];
      break;
    }
  }
  count = Math.ceil(target / best[1].capacity_pints_day);

  return {
    dehu_id: best[0],
    dehu_name: best[1].name,
    count,
    capacity_pints_day: best[1].capacity_pints_day * count,
    required_pints_day: total_pints_day,
    placement: 'Place at floor level near room center or return-air side. Ensure drainage to floor drain or collection tank.',
    plant_count
  };
}

/**
 * Calculate full room equipment requirements from specs + crop recipe.
 */
export function calculateRoomRequirements({ room_area_m2, ceiling_height_m, plant_count, target_ppfd, light_preference, hydro_system }) {
  const light_id = light_preference || 'led-panel-200w';
  const lights = calculateLightsNeeded(light_id, target_ppfd || 300, room_area_m2);
  const fans = recommendFans(room_area_m2, ceiling_height_m);
  const dehu = recommendDehumidifier(plant_count || 50);
  const cooling = calculateCoolingRequirement(
    lights.ok ? lights.total_heat_btu_hr : 0,
    room_area_m2,
    ceiling_height_m
  );

  // Pick HVAC
  let hvac_id = 'mini-split-9k';
  if (cooling.total_cooling_btu > 10000) hvac_id = 'mini-split-12k';
  if (cooling.total_cooling_btu > 15000) hvac_id = 'mini-split-18k';

  const hydro = hydro_system ? HYDRO_SYSTEM_DB[hydro_system] : null;

  return {
    ok: true,
    room_specs: { area_m2: room_area_m2, ceiling_height_m, volume_m3: room_area_m2 * ceiling_height_m },
    lighting: lights,
    fans,
    dehumidification: dehu,
    cooling,
    hvac: { hvac_id, ...HVAC_DB[hvac_id] },
    hydroponic_system: hydro,
    total_estimated_wattage: Math.round(
      (lights.ok ? lights.total_wattage : 0) +
      (fans.exhaust.count * (FAN_DB[fans.exhaust.fan_id]?.wattage || 0)) +
      (fans.circulation.count * (FAN_DB[fans.circulation.fan_id]?.wattage || 0)) +
      (dehu.count * (DEHUMIDIFIER_DB[dehu.dehu_id]?.wattage || 0)) +
      (HVAC_DB[hvac_id]?.wattage_cooling || 0)
    )
  };
}

export default {
  LIGHT_DB, FAN_DB, DEHUMIDIFIER_DB, HVAC_DB, HYDRO_SYSTEM_DB,
  calculateAirExchanges, calculateLightHeatLoad, calculateCoolingRequirement,
  calculateDehumidification, calculateLightsNeeded, recommendFans,
  recommendDehumidifier, calculateRoomRequirements
};
