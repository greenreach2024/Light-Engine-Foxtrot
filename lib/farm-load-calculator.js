/**
 * Farm Load Calculator
 * ====================
 *
 * Pure functions that lift the load-math formulas from
 * docs/features/VERTICAL_FARM_CALCULATOR_SPEC.md into a testable library,
 * parameterised by the per-template values in public/data/grow-systems.json.
 *
 * Outputs are shaped to drop directly into the `buildPlan` subtree of
 * rooms.json (see docs/features/ROOM_BUILD_PLAN_SCHEMA.md):
 *
 *   {
 *     computedLoad: {
 *       lightingKW, coolingTons, dehumLPerDay,
 *       supplyFanCFM, pumpKW, totalCircuitKW
 *     },
 *     reservedControllerSlots: [
 *       { subsystem, controllerClass, channels, templateId, zoneId? },
 *       ...
 *     ]
 *   }
 *
 * Intentional non-goals in this file:
 *   - No runtime device discovery, no MAC / DMX-universe / tenant IDs.
 *   - No I/O. The caller loads grow-systems.json and passes the template
 *     objects in. This keeps the calculator deterministic and unit-testable.
 *   - No currency / CAPEX math. The VFC spec covers pricing too, but pricing
 *     is grant-wizard territory and not part of Phase-A build plans.
 *
 * Formula provenance:
 *   - Lighting kWh, 16h/18h photoperiods, fixture watts:
 *     VFC §"Lighting System" + template.defaultFixtureClass
 *   - Pump watts per 10k plants + duty cycle:
 *     VFC §"Hydroponic System" + template.irrigation
 *   - Transpiration g/plant/day, latent BTU/hr, sensible factor, cooling
 *     tons, dehumidifier L/day:
 *     VFC §"HVAC & Dehumidification" + template.transpiration
 *   - Fan CFM: not spec'd directly in VFC (which counts fans but not flow);
 *     derived from envelope-class ACH defaults documented below. When a
 *     grower wants tighter numbers they can override `envelopeAchMap`.
 *   - Circuit kW: sum of lighting (nominal) + pump (peak, no duty cycle) +
 *     HVAC electrical (coolingTons * 1.2 kW, VFC EER-10 assumption) +
 *     dehumidifier electrical (dehumLPerDay / 150 * 0.4 kW, VFC's 150 L/day
 *     dehumidifier ≈ 400W benchmark).
 */

/**
 * Default air changes per hour by envelope class. Used by computeSupplyFanCFM
 * when the caller doesn't override. These are conservative commercial grow
 * room defaults; override when your HVAC engineer has a better number.
 */
export const DEFAULT_ENVELOPE_ACH = {
  well_insulated: 20,
  typical: 30,
  poorly_insulated: 45,
  outdoor_ambient: 60
};

const METRES3_TO_FT3 = 35.3146667;
const TONS_PER_BTU_HR = 1 / 12000;
const LATENT_HEAT_BTU_PER_KG_WATER = 1055; // VFC spec constant
const HOURS_PER_DAY = 24;
const COOLING_KW_PER_TON = 1.2; // VFC: EER 10
const DEHUM_KW_PER_LPD = 0.4 / 150; // VFC: ~400W per 150 L/day dehumidifier

/**
 * Count plants in a single installed-system instance.
 *
 * plants = quantity × tierCount × traysPerTier × plantsPerTrayByClass[cropClass]
 */
export function countPlants(system) {
  const { template, quantity, cropClass } = system;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(
      `countPlants: quantity must be a positive finite number (got ${quantity === undefined ? 'undefined' : JSON.stringify(quantity)}) on template "${template?.id}"`
    );
  }
  const perTray = template.plantsPerTrayByClass[cropClass];
  if (perTray === undefined) {
    throw new Error(
      `plantsPerTrayByClass missing cropClass "${cropClass}" on template "${template.id}"`
    );
  }
  return quantity * template.tierCount * template.traysPerTier * perTray;
}

/**
 * Lighting load for one installed-system instance.
 *
 *   fixtureCount        = quantity × tierCount × fixturesPerTierUnit
 *   lightingKW (peak)   = fixtureCount × fixtureWattsNominal / 1000
 *   dailyLightingKWh    = lightingKW × photoperiodHours
 *
 * Peak kW is what the electrical panel needs to supply and what we report in
 * buildPlan.computedLoad.lightingKW. Daily kWh is useful for OPEX math and
 * is returned alongside but not aggregated into buildPlan.
 */
export function computeLightingLoad(system) {
  const { template, quantity, cropClass } = system;
  const { fixturesPerTierUnit, fixtureWattsNominal, photoperiodHoursByClass } =
    template.defaultFixtureClass;

  const photoperiodHours = photoperiodHoursByClass[cropClass];
  if (photoperiodHours === undefined) {
    throw new Error(
      `photoperiodHoursByClass missing cropClass "${cropClass}" on template "${template.id}"`
    );
  }

  const fixtureCount = quantity * template.tierCount * fixturesPerTierUnit;
  const lightingKW = (fixtureCount * fixtureWattsNominal) / 1000;
  const dailyLightingKWh = lightingKW * photoperiodHours;

  return { fixtureCount, lightingKW, dailyLightingKWh, photoperiodHours };
}

/**
 * Hydroponic pump load for one installed-system instance.
 *
 *   plants              = (see countPlants)
 *   pumpKW (peak)       = (supplyW + returnW) × plants / 10000 / 1000
 *   pumpKW (averaged)   = pumpKW_peak × dutyCycle
 *
 * Peak is what the panel must supply (all pumps running). Averaged is for
 * thermal / energy math.
 */
export function computePumpLoad(system) {
  const { template } = system;
  const {
    supplyPumpWattsPer10kPlants,
    returnPumpWattsPer10kPlants,
    dutyCycle
  } = template.irrigation;

  const plants = countPlants(system);
  const wPeakPer10k = supplyPumpWattsPer10kPlants + returnPumpWattsPer10kPlants;
  const pumpKWPeak = (wPeakPer10k * plants) / 10000 / 1000;
  const pumpKWAvg = pumpKWPeak * dutyCycle;

  return { plants, pumpKWPeak, pumpKWAvg };
}

/**
 * Transpiration → HVAC / dehumidifier load for one installed-system instance.
 *
 *   dailyWaterKg    = plants × gPerPlantPerDayByClass[cropClass] / 1000
 *   latentBTUperHr  = dailyWaterKg × 1055 BTU/kg / 24h
 *   totalBTUperHr   = latentBTUperHr × (1 + sensibleHeatFactor)
 *   coolingTons     = totalBTUperHr / 12000
 *   dehumLPerDay    = dailyWaterKg  (1 kg water ≈ 1 L)
 *
 * Matches VFC worked example: 10,000 plants × 30 g/day / 1000 = 300 kg/day;
 * 300 × 1055 / 24 = 13,188 latent BTU/hr; × 1.3 = 17,144 total; / 12000 =
 * 1.43 tons. Spec rounds to 1.4.
 */
export function computeTranspirationLoad(system) {
  const { template, cropClass } = system;
  const { gPerPlantPerDayByClass, sensibleHeatFactor } = template.transpiration;

  const gPerPlantPerDay = gPerPlantPerDayByClass[cropClass];
  if (gPerPlantPerDay === undefined) {
    throw new Error(
      `gPerPlantPerDayByClass missing cropClass "${cropClass}" on template "${template.id}"`
    );
  }

  const plants = countPlants(system);
  const dailyWaterKg = (plants * gPerPlantPerDay) / 1000;
  const latentBTUperHr =
    (dailyWaterKg * LATENT_HEAT_BTU_PER_KG_WATER) / HOURS_PER_DAY;
  const totalBTUperHr = latentBTUperHr * (1 + sensibleHeatFactor);
  const coolingTons = totalBTUperHr * TONS_PER_BTU_HR;
  const dehumLPerDay = dailyWaterKg; // 1 L ≈ 1 kg water

  return {
    plants,
    dailyWaterKg,
    latentBTUperHr,
    totalBTUperHr,
    coolingTons,
    dehumLPerDay,
    gPerPlantPerDay
  };
}

/**
 * Room supply fan CFM, sized by volumetric air changes per hour.
 *
 *   volumeM3  = lengthM × widthM × ceilingHeightM
 *   volumeFt3 = volumeM3 × 35.3147
 *   CFM       = volumeFt3 × ACH / 60
 *
 * ACH is looked up from `achMap` by room.envelope.class, defaulting to
 * DEFAULT_ENVELOPE_ACH. Returns 0 when dimensions are missing (lets callers
 * still run the calculator for a pre-Phase-A room with no dimensions block).
 */
export function computeSupplyFanCFM(room, achMap = DEFAULT_ENVELOPE_ACH) {
  const dims = room?.dimensions;
  if (!dims) return 0;
  const { lengthM, widthM, ceilingHeightM } = dims;
  if (!lengthM || !widthM || !ceilingHeightM) return 0;

  const envelopeClass = room?.envelope?.class ?? 'typical';
  const ach = achMap[envelopeClass] ?? achMap.typical ?? 30;

  const volumeFt3 = lengthM * widthM * ceilingHeightM * METRES3_TO_FT3;
  return (volumeFt3 * ach) / 60;
}

/**
 * Sum the HVAC & dehumidifier electrical draw so we can include them in
 * totalCircuitKW.
 *
 *   hvacKW   = coolingTons × 1.2 kW/ton   (VFC EER-10 assumption)
 *   dehumKW  = dehumLPerDay / 150 × 0.4 kW (VFC 150L/day ≈ 400W benchmark)
 */
export function computeClimateElectricalKW({ coolingTons, dehumLPerDay }) {
  return {
    hvacKW: coolingTons * COOLING_KW_PER_TON,
    dehumKW: dehumLPerDay * DEHUM_KW_PER_LPD
  };
}

/**
 * Reserved controller-slot entries for one installed-system instance.
 *
 * Channel math is straight multiplication against template.requiredChannels,
 * with `ceil` where a fractional reservation would leave a gap (a partial
 * pump header still needs a whole channel).
 */
export function computeReservedSlots(system) {
  const { template, quantity, zoneId } = system;
  const plants = countPlants(system);
  const {
    lightsPerTier,
    pumpsPer10kPlants,
    fansPer5Racks,
    sensorsPerZone
  } = template.requiredChannels;
  const controllers = template.defaultControllerClass;

  const slots = [];

  slots.push({
    subsystem: 'lights',
    controllerClass: controllers.lights.type,
    channels: lightsPerTier * template.tierCount * quantity,
    templateId: template.id,
    ...(zoneId ? { zoneId } : {})
  });

  slots.push({
    subsystem: 'pumps',
    controllerClass: controllers.pumps.type,
    channels: Math.max(1, Math.ceil((pumpsPer10kPlants * plants) / 10000)),
    templateId: template.id,
    ...(zoneId ? { zoneId } : {})
  });

  slots.push({
    subsystem: 'fans',
    controllerClass: controllers.fans.type,
    channels: Math.max(1, Math.ceil((fansPer5Racks * quantity) / 5)),
    templateId: template.id,
    ...(zoneId ? { zoneId } : {})
  });

  slots.push({
    subsystem: 'sensors',
    controllerClass: controllers.sensors.type,
    channels: sensorsPerZone, // per zone the system lives in
    templateId: template.id,
    ...(zoneId ? { zoneId } : {})
  });

  return slots;
}

/**
 * Full room load calculation.
 *
 * @param {object} args
 * @param {object} args.room    - { dimensions: {lengthM,widthM,ceilingHeightM}, envelope?: {class} }
 * @param {Array}  args.systems - Each { template, quantity, cropClass, zoneId? }
 *                                where `template` is a full grow-systems.json template object.
 * @param {object} [args.achMap] - Optional override for envelope → ACH lookup.
 *
 * @returns {object}
 *   {
 *     computedLoad: { lightingKW, coolingTons, dehumLPerDay, supplyFanCFM, pumpKW, totalCircuitKW },
 *     reservedControllerSlots: Array,
 *     perSystem: Array  // per-system breakdown for UI / debugging; not persisted to buildPlan
 *   }
 */
export function computeRoomLoad({ room, systems, achMap = DEFAULT_ENVELOPE_ACH }) {
  if (!room) throw new Error('computeRoomLoad: room is required');
  if (!Array.isArray(systems)) {
    throw new Error('computeRoomLoad: systems must be an array');
  }

  let lightingKW = 0;
  let pumpKWPeak = 0;
  let coolingTons = 0;
  let dehumLPerDay = 0;
  const reservedControllerSlots = [];
  const perSystem = [];

  for (const system of systems) {
    if (!system?.template) {
      throw new Error('computeRoomLoad: each system must include a resolved template');
    }
    if (!system.cropClass) {
      throw new Error(
        `computeRoomLoad: cropClass missing for system (templateId="${system.template?.id}")`
      );
    }

    const lighting = computeLightingLoad(system);
    const pumps = computePumpLoad(system);
    const transpiration = computeTranspirationLoad(system);
    const slots = computeReservedSlots(system);

    lightingKW += lighting.lightingKW;
    pumpKWPeak += pumps.pumpKWPeak;
    coolingTons += transpiration.coolingTons;
    dehumLPerDay += transpiration.dehumLPerDay;
    reservedControllerSlots.push(...slots);

    perSystem.push({
      templateId: system.template.id,
      quantity: system.quantity,
      cropClass: system.cropClass,
      zoneId: system.zoneId,
      plants: transpiration.plants,
      lighting,
      pumps,
      transpiration
    });
  }

  const supplyFanCFM = computeSupplyFanCFM(room, achMap);
  const { hvacKW, dehumKW } = computeClimateElectricalKW({
    coolingTons,
    dehumLPerDay
  });

  const totalCircuitKW = lightingKW + pumpKWPeak + hvacKW + dehumKW;

  return {
    computedLoad: {
      lightingKW,
      coolingTons,
      dehumLPerDay,
      supplyFanCFM,
      pumpKW: pumpKWPeak,
      totalCircuitKW
    },
    reservedControllerSlots,
    perSystem
  };
}

/**
 * Resolve rooms.json `installedSystems[]` entries against a grow-systems
 * registry so they can be handed to computeRoomLoad. The caller supplies a
 * `cropClassFor(system, index)` resolver because `cropClass` is not yet a
 * rooms.json field (that'll land in step 4 alongside the build-plan
 * endpoint).
 *
 * @param {object} room - A rooms.json room entry (must have installedSystems).
 * @param {object} registry - Parsed grow-systems.json.
 * @param {Function} cropClassFor - (installedSystemEntry, index) => cropClass
 */
export function resolveInstalledSystems(room, registry, cropClassFor) {
  const templatesById = new Map(
    (registry?.templates || []).map((t) => [t.id, t])
  );
  const installed = Array.isArray(room?.installedSystems)
    ? room.installedSystems
    : [];

  return installed.map((entry, idx) => {
    const template = templatesById.get(entry.templateId);
    if (!template) {
      throw new Error(
        `resolveInstalledSystems: templateId "${entry.templateId}" not found in registry (room "${room?.id}" installedSystems[${idx}])`
      );
    }
    if (
      typeof entry.quantity !== 'number' ||
      !Number.isFinite(entry.quantity) ||
      entry.quantity <= 0
    ) {
      throw new Error(
        `resolveInstalledSystems: quantity must be a positive finite number for room "${room?.id}" installedSystems[${idx}] (templateId="${entry.templateId}", got ${entry.quantity === undefined ? 'undefined' : JSON.stringify(entry.quantity)})`
      );
    }
    const cropClass = cropClassFor(entry, idx);
    if (!cropClass) {
      throw new Error(
        `resolveInstalledSystems: cropClassFor returned no cropClass for room "${room?.id}" installedSystems[${idx}] (templateId="${entry.templateId}")`
      );
    }
    return {
      template,
      quantity: entry.quantity,
      cropClass,
      zoneId: entry.zoneId
    };
  });
}

export default {
  DEFAULT_ENVELOPE_ACH,
  countPlants,
  computeLightingLoad,
  computePumpLoad,
  computeTranspirationLoad,
  computeSupplyFanCFM,
  computeClimateElectricalKW,
  computeReservedSlots,
  computeRoomLoad,
  resolveInstalledSystems
};
