/**
 * Grow-System Scoring
 * ===================
 *
 * Pure functions that compute three comparable 0-100 scores for a
 * grow-systems.json template deployed at a given quantity + crop class
 * inside a room envelope:
 *
 *   - transpiration:   moisture load the deployment will put into the room
 *   - heatManagement:  heat concentration per m3 of room volume
 *   - envBenchmark:    composite fit vs. an "easy to run" benchmark
 *
 * The scoring surface is intentionally narrow — three numbers plus the
 * numeric inputs that produced them. UI cards can render the number; ops
 * tooling can render the breakdown. Equipment recommendations (HVAC class,
 * dehumidifier capacity, fan sizing) consume the raw load totals, not the
 * scores, so they stay decoupled.
 *
 * All heavy lifting reuses lib/farm-load-calculator.js:
 *   countPlants, computeLightingLoad, computeTranspirationLoad,
 *   computeSupplyFanCFM.
 *
 * No I/O. Callers pass the resolved template object in; the API layer is
 * responsible for loading grow-systems.json.
 */

import {
  countPlants,
  computeLightingLoad,
  computeTranspirationLoad,
  computeSupplyFanCFM,
  DEFAULT_ENVELOPE_ACH
} from './farm-load-calculator.js';

// ---- Scoring reference constants ------------------------------------------
// Documented thresholds so the scores stay comparable across templates and
// room sizes. Tune these from real deployment data as it accumulates.

// Transpiration: a single 3-tier NFT rack of leafy greens produces ~27 kg/day
// water; four racks + fruiting in the same room push 60+. Set 30 kg/day as
// "full commercial dehu required" (score 100) so a single small rack scores
// mid-range and multi-unit rooms clearly saturate.
const T_REF_KG_PER_DAY = 30;

// Heat management: lighting + sensible-heat transpiration concentration in
// W/m3. 250 W/m3 is "this room needs active cooling all year" per the VFC
// spec's worked examples; below 50 W/m3 is passive-cooling territory.
const H_REF_W_PER_M3 = 250;

// Fraction of fixture wattage that becomes heat in the grow space. LED
// fixtures are ~50-55% electrical-to-light efficient; the rest is heat.
// We use 0.9 as a conservative upper bound suitable for breaker-sizing-
// style scoring (nearly all watts become heat inside the envelope, even
// the photon energy ultimately converts once absorbed by plants/walls).
const LIGHTING_HEAT_FRACTION = 0.9;

// Latent heat of vaporization (W-day/kg). 2454 kJ/kg / 86400 s = ~28.4 W-day/kg
// means 1 kg of transpired water represents ~28.4 W of continuous latent load
// over a full day. Used to fold transpiration into the per-m3 heat metric.
const LATENT_W_DAY_PER_KG = 2454_000 / 86_400;

const M3_TO_FT3 = 35.3146667;

// Environmental benchmark weights. They sum to 1.0 so the result is naturally
// 0-100 without extra scaling.
const E_WEIGHTS = Object.freeze({
  transpirationStress: 0.35,
  heatStress: 0.35,
  airflowDeficit: 0.20,
  vpdRisk: 0.10
});

/**
 * Clamp a number into [min, max]. Used so rounding + pathological inputs
 * can't produce scores outside 0..100.
 */
export function clamp(value, min = 0, max = 100) {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Room volume in m^3 given a room shape with optional dimensions block.
 * Returns 0 when any required dimension is missing so callers can detect
 * "room volume unknown" and hand back a neutral H / E score.
 */
export function roomVolumeM3(room) {
  const d = room?.dimensions || {};
  const l = Number(d.lengthM ?? d.length_m);
  const w = Number(d.widthM ?? d.width_m);
  const h = Number(d.ceilingHeightM ?? d.ceiling_height_m);
  if (!Number.isFinite(l) || !Number.isFinite(w) || !Number.isFinite(h)) return 0;
  if (l <= 0 || w <= 0 || h <= 0) return 0;
  return l * w * h;
}

/**
 * Plant Transpiration Score (T).
 *
 *   dailyWaterKg = countPlants × gPerPlantPerDay / 1000   (from farm-load-calc)
 *   score        = clamp(dailyWaterKg / T_REF_KG_PER_DAY × 100, 0, 100)
 *
 * Higher score = more moisture load = more dehumidification needed. A score
 * of 100 means the deployment alone produces enough water to saturate a
 * single commercial-class dehumidifier. Useful on a card to communicate
 * "what this unit demands" rather than "how healthy it is" — a 90 score
 * is not bad, it means operators need to size dehumidification accordingly.
 */
export function scoreTranspiration({ template, cropClass, quantity = 1 }) {
  assertScorableSystem({ template, cropClass, quantity });

  const plantsTotal = countPlants({ template, quantity, cropClass });
  const transpiration = computeTranspirationLoad({ template, quantity, cropClass });
  const dailyWaterKg = transpiration.dailyWaterKg;

  const score = clamp((dailyWaterKg / T_REF_KG_PER_DAY) * 100);

  return {
    score: roundTo1(score),
    dailyWaterKg: roundTo2(dailyWaterKg),
    plantsTotal,
    gPerPlantPerDay: transpiration.gPerPlantPerDay,
    referenceKgPerDay: T_REF_KG_PER_DAY,
    rationale: buildTranspirationRationale(plantsTotal, transpiration.gPerPlantPerDay, dailyWaterKg, score)
  };
}

/**
 * Heat Management Score (H).
 *
 *   fixtureHeatW       = lightingKW × 1000 × LIGHTING_HEAT_FRACTION
 *   latentW            = dailyWaterKg × LATENT_W_DAY_PER_KG
 *   sensibleTranspW    = latentW × transpiration.sensibleHeatFactor
 *   totalHeatW         = fixtureHeatW + latentW + sensibleTranspW
 *   wPerM3             = totalHeatW / roomVolumeM3      (when known)
 *   wPerM3Equivalent   = totalHeatW / (footprintM2 × heightM)   (tier-aware fallback)
 *   score              = clamp(wPerM3 / H_REF_W_PER_M3 × 100)
 *
 * When room volume is unavailable we fall back to a per-template
 * "effective footprint volume" using the template's own height and
 * footprint so a multi-tier rack (which stacks heat vertically) still
 * scores higher than a flat bench of the same wattage. This keeps H
 * comparable across templates before the grower has configured a room.
 */
export function scoreHeatManagement({ template, cropClass, quantity = 1, room = null }) {
  assertScorableSystem({ template, cropClass, quantity });

  const lighting = computeLightingLoad({ template, quantity, cropClass });
  const transpiration = computeTranspirationLoad({ template, quantity, cropClass });

  const fixtureHeatW = lighting.lightingKW * 1000 * LIGHTING_HEAT_FRACTION;
  const latentW = transpiration.dailyWaterKg * LATENT_W_DAY_PER_KG;
  const sensibleTranspirationW = latentW * (template.transpiration?.sensibleHeatFactor ?? 0);
  const totalHeatW = fixtureHeatW + latentW + sensibleTranspirationW;

  const roomVol = roomVolumeM3(room);
  let denominatorM3;
  let volumeSource;
  if (roomVol > 0) {
    denominatorM3 = roomVol;
    volumeSource = 'room';
  } else {
    // Tier-aware fallback: templates stack vertically, so footprint × template
    // height gives a comparable per-unit envelope. Multi-unit deployments
    // scale the footprint linearly, which is correct for heat-per-m3.
    const fp = template.footprintM || {};
    const footprintM2 = Number(fp.length) * Number(fp.width);
    const heightM = Number(template.heightM);
    if (!Number.isFinite(footprintM2) || !Number.isFinite(heightM) || footprintM2 <= 0 || heightM <= 0) {
      // Nothing to normalize against — return neutral score with a flag.
      return {
        score: 50,
        totalHeatW: roundTo1(totalHeatW),
        wPerM3: null,
        lightingKW: roundTo2(lighting.lightingKW),
        volumeSource: 'unknown',
        rationale: 'Room volume unknown; returning neutral score. Configure room dimensions for a real heat-management score.'
      };
    }
    denominatorM3 = footprintM2 * heightM * quantity;
    volumeSource = 'template';
  }

  const wPerM3 = totalHeatW / denominatorM3;
  const score = clamp((wPerM3 / H_REF_W_PER_M3) * 100);

  return {
    score: roundTo1(score),
    totalHeatW: roundTo1(totalHeatW),
    wPerM3: roundTo1(wPerM3),
    lightingKW: roundTo2(lighting.lightingKW),
    volumeSource,
    referenceWPerM3: H_REF_W_PER_M3,
    rationale: buildHeatRationale(lighting.lightingKW, totalHeatW, wPerM3, volumeSource, score)
  };
}

/**
 * Airflow headroom: how much supply CFM the room has vs. the ACH-sized
 * requirement for its envelope. Returns a 0-100 stress score where 0 = plenty
 * of headroom and 100 = room cannot move enough air even at nameplate CFM.
 * Falls back to 50 (neutral) when dimensions or supply CFM are unknown.
 *
 *   requiredCFM = volumeFt3 × envelopeACH / 60
 *   available   = room.supplyCFM (caller-supplied, e.g. fan nameplate sum)
 *   deficit     = max(0, requiredCFM - available) / requiredCFM × 100
 */
export function scoreAirflowDeficit(room, achMap = DEFAULT_ENVELOPE_ACH) {
  const roomVol = roomVolumeM3(room);
  if (roomVol <= 0) return { score: 50, volumeSource: 'unknown', rationale: 'Room volume unknown.' };

  const requiredCFM = computeSupplyFanCFM(room, achMap);
  const supplyCFM = Number(room?.supplyCFM ?? room?.supply_cfm);

  if (!Number.isFinite(supplyCFM) || supplyCFM <= 0) {
    return {
      score: 50,
      requiredCFM: roundTo1(requiredCFM),
      supplyCFM: null,
      volumeSource: 'room',
      rationale: 'Supply CFM not configured; returning neutral score.'
    };
  }

  const deficitFrac = Math.max(0, (requiredCFM - supplyCFM) / requiredCFM);
  const score = clamp(deficitFrac * 100);

  return {
    score: roundTo1(score),
    requiredCFM: roundTo1(requiredCFM),
    supplyCFM: roundTo1(supplyCFM),
    volumeSource: 'room',
    rationale: score < 10
      ? 'Supply fans exceed room ACH requirement; airflow headroom is comfortable.'
      : score < 40
        ? 'Supply fans meet room ACH requirement with modest headroom.'
        : score < 70
          ? 'Supply fans are undersized vs. room ACH target; expect warm spots.'
          : 'Severe airflow deficit; room will not hit target ACH at nameplate CFM.'
  };
}

/**
 * VPD risk score (0-100, higher = worse) given a recipe's max_humidity and
 * target VPD, plus the transpiration load. A crop recipe that demands very
 * low humidity while the deployment transpires heavily is hard to run.
 *
 * When recipe or targets are missing we return a neutral 20 so env-benchmark
 * isn't skewed by an absent input.
 */
export function scoreVpdRisk({ recipe = null, transpirationScore = 0 } = {}) {
  if (!recipe) return { score: 20, rationale: 'No recipe provided; neutral VPD risk applied.' };

  const maxHumidity = Number(recipe.max_humidity ?? recipe.maxHumidity);
  const targetVpd = Number(recipe.vpd ?? recipe.targetVpd);
  if (!Number.isFinite(maxHumidity) && !Number.isFinite(targetVpd)) {
    return { score: 20, rationale: 'Recipe has no humidity/VPD targets; neutral VPD risk applied.' };
  }

  // Heuristic: tighter envelopes (low max_humidity OR high VPD target) combined
  // with heavy transpiration push risk up. 0.5 scales transpiration load against
  // a 50% dry-down requirement so typical leafy greens land around 20-40.
  let risk = 0;
  if (Number.isFinite(maxHumidity)) {
    // Low ceiling (<55%) is tight; 80%+ is lax.
    risk += clamp((80 - maxHumidity) * 1.2, 0, 60);
  }
  if (Number.isFinite(targetVpd)) {
    // Flowering VPD (1.2+) is aggressive.
    risk += clamp((targetVpd - 0.6) * 40, 0, 40);
  }
  risk += transpirationScore * 0.25;

  return {
    score: roundTo1(clamp(risk)),
    maxHumidity: Number.isFinite(maxHumidity) ? maxHumidity : null,
    targetVpd: Number.isFinite(targetVpd) ? targetVpd : null,
    rationale: buildVpdRationale(maxHumidity, targetVpd, transpirationScore)
  };
}

/**
 * Environmental Benchmark Score (E).
 *
 * Composite "how close does this deployment sit to an easy-to-run benchmark
 * room" — higher is better. 100 = benchmark or better; 0 = this deployment
 * will struggle to hold recipe targets in the given room.
 *
 *   stress     = T_weight×T + H_weight×H + airflow_weight×airflowDeficit + vpd_weight×vpdRisk
 *   E          = clamp(100 - stress)
 *
 * Note: T and H use their raw 0-100 values as stress components (higher =
 * more work for HVAC). Airflow/VPD already return stress scores.
 */
export function scoreEnvBenchmark({ template, cropClass, quantity = 1, room = null, recipe = null } = {}) {
  const transpiration = scoreTranspiration({ template, cropClass, quantity });
  const heat = scoreHeatManagement({ template, cropClass, quantity, room });
  const airflow = scoreAirflowDeficit(room);
  const vpd = scoreVpdRisk({ recipe, transpirationScore: transpiration.score });

  const stress =
    E_WEIGHTS.transpirationStress * transpiration.score +
    E_WEIGHTS.heatStress * heat.score +
    E_WEIGHTS.airflowDeficit * airflow.score +
    E_WEIGHTS.vpdRisk * vpd.score;

  const score = clamp(100 - stress);

  return {
    score: roundTo1(score),
    breakdown: {
      transpiration: transpiration.score,
      heatManagement: heat.score,
      airflowDeficit: airflow.score,
      vpdRisk: vpd.score
    },
    weights: { ...E_WEIGHTS },
    inputs: { transpiration, heatManagement: heat, airflow, vpd },
    rationale: buildBenchmarkRationale(score, { transpiration, heat, airflow, vpd })
  };
}

/**
 * Convenience: all three scores + a typed tier label for UI cards.
 */
export function scoreTemplate(args) {
  const transpiration = scoreTranspiration(args);
  const heatManagement = scoreHeatManagement(args);
  const envBenchmark = scoreEnvBenchmark(args);
  return {
    templateId: args.template?.id,
    cropClass: args.cropClass,
    quantity: args.quantity ?? 1,
    transpiration,
    heatManagement,
    envBenchmark,
    tier: benchmarkTier(envBenchmark.score)
  };
}

/**
 * Bucket an env-benchmark score into a named tier for UI presentation.
 * These thresholds are coarse on purpose — fine-grained differentiation
 * belongs in the raw number, not the label.
 */
export function benchmarkTier(score) {
  if (score >= 80) return 'benchmark';
  if (score >= 60) return 'favorable';
  if (score >= 40) return 'manageable';
  if (score >= 20) return 'demanding';
  return 'stressed';
}

// ---- Helpers ---------------------------------------------------------------

function assertScorableSystem({ template, cropClass, quantity }) {
  if (!template || typeof template !== 'object') {
    throw new Error('scoring: template is required');
  }
  if (!cropClass || typeof cropClass !== 'string') {
    throw new Error(`scoring: cropClass is required (template="${template.id}")`);
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`scoring: quantity must be a positive finite number (got ${quantity})`);
  }
}

function roundTo1(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : n;
}
function roundTo2(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}

function buildTranspirationRationale(plants, gPerPlant, kgPerDay, score) {
  if (score <= 20) {
    return `${plants} plants × ${gPerPlant} g/day = ${kgPerDay.toFixed(1)} kg/day; low moisture load, passive room management likely sufficient.`;
  }
  if (score <= 50) {
    return `${plants} plants × ${gPerPlant} g/day = ${kgPerDay.toFixed(1)} kg/day; moderate moisture load, plan for a commercial-class dehumidifier.`;
  }
  if (score <= 80) {
    return `${plants} plants × ${gPerPlant} g/day = ${kgPerDay.toFixed(1)} kg/day; heavy moisture load; dehumidifier must be sized to match.`;
  }
  return `${plants} plants × ${gPerPlant} g/day = ${kgPerDay.toFixed(1)} kg/day; at or above full commercial dehumidifier capacity; plan for redundancy.`;
}

function buildHeatRationale(lightingKW, totalHeatW, wPerM3, volumeSource, score) {
  const base = `${lightingKW.toFixed(2)} kW lighting + transpiration = ${(totalHeatW / 1000).toFixed(2)} kW heat`;
  if (wPerM3 === null) return `${base}; room volume unknown.`;
  const volNote = volumeSource === 'room' ? 'in configured room' : 'per template footprint (no room yet)';
  if (score <= 25) return `${base}, ~${wPerM3.toFixed(0)} W/m3 ${volNote}; passive cooling territory.`;
  if (score <= 55) return `${base}, ~${wPerM3.toFixed(0)} W/m3 ${volNote}; standard HVAC sizing applies.`;
  if (score <= 80) return `${base}, ~${wPerM3.toFixed(0)} W/m3 ${volNote}; active cooling required year-round.`;
  return `${base}, ~${wPerM3.toFixed(0)} W/m3 ${volNote}; severe heat concentration; oversize HVAC or spread load across zones.`;
}

function buildVpdRationale(maxHumidity, targetVpd, tScore) {
  const parts = [];
  if (Number.isFinite(maxHumidity)) parts.push(`max_humidity ${maxHumidity}%`);
  if (Number.isFinite(targetVpd)) parts.push(`target VPD ${targetVpd} kPa`);
  parts.push(`transpiration score ${tScore}`);
  return `VPD risk assessed from ${parts.join(', ')}.`;
}

function buildBenchmarkRationale(score, { transpiration, heat, airflow, vpd }) {
  const label = benchmarkTier(score);
  return (
    `Benchmark tier: ${label} (E=${score.toFixed(1)}). ` +
    `T=${transpiration.score}, H=${heat.score}, airflow_deficit=${airflow.score}, vpd_risk=${vpd.score}.`
  );
}

// Re-export constants for tests and downstream callers.
export const SCORING_CONSTANTS = Object.freeze({
  T_REF_KG_PER_DAY,
  H_REF_W_PER_M3,
  LIGHTING_HEAT_FRACTION,
  LATENT_W_DAY_PER_KG,
  M3_TO_FT3,
  E_WEIGHTS
});
