// automation/recipe-nutrient-targets.js -- Server-side recipe-driven nutrient target resolver.
//
// This is the nutrient analogue of `automation/recipe-environmental-targets.js`. It reads the
// same source-of-truth the UI uses (enriched groups with `plan.days[]`) and computes, per tank,
// the EC (mS/cm) and pH setpoints a recipe is calling for at the current growth day.
//
// Design choices:
//   - Tank routing defaults to the 2-tank split (Tank 1 = vegetative, Tank 2 = fruiting)
//     but callers can supply opts.tankConfig for N-tank support.
//   - Aggregation across multiple groups uses a PLANT-COUNT WEIGHTED AVERAGE, matching the
//     environmental resolver's approach. The UI currently uses `max()`, which is noisier and
//     less fair when one small group has aggressive targets. Callers that want the old
//     behaviour can pass `{ aggregator: 'max' }`.
//   - All input is taken by value (no db / fs) so it's trivially testable and reusable
//     from both the nutrient poller and future autopilot paths.
//
// Output shape per tank:
//   {
//     ec:       <mS/cm, finite number, or null if no active groups inform it>,
//     ph:       <pH,   finite number, or null>,
//     sources:  [ { groupId, name, crop, day, stage, ec, ph, weight, fromRecipe } ],
//     reason:   'recipe' | 'fallback-default' | 'no-active-groups' | 'no-recipe-day'
//   }
//
// See `public/views/nutrient-management.html::determineGroupStage()` for the UI counterpart.

const DEFAULT_EC_TARGETS = {
  establishment: 1.0,
  vegetative: 1.6,
  earlyFlowering: 2.2,
  heavyFruiting: 2.8
};

const DEFAULT_PH_TARGETS = {
  establishment: 6.0,
  vegetative: 6.0,
  earlyFlowering: 6.2,
  heavyFruiting: 6.2
};

const FRUITING_STAGE_RX = /flower|fruit/i;
const HEAVY_FRUITING_RX = /fruit|heavy|harvest/i;
const EARLY_FLOWERING_RX = /flower|early/i;

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function calculateCurrentDay(group, now = new Date()) {
  const anchor = group?.planConfig?.anchor || {};
  if (Number.isFinite(anchor.dps)) {
    return Math.max(1, Number(anchor.dps));
  }
  const seed = anchor.seedDate ? new Date(anchor.seedDate) : null;
  if (seed && !Number.isNaN(seed.getTime())) {
    const days = Math.floor((now.getTime() - seed.getTime()) / 86_400_000);
    return Math.max(1, days + 1);
  }
  const start = group?.plan?.startDate ? new Date(group.plan.startDate) : null;
  if (start && !Number.isNaN(start.getTime())) {
    const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
    return Math.max(1, days + 1);
  }
  return 1;
}

function findScheduleDay(days, currentDay) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const exact = days.find((d) => Number(d?.day) === currentDay);
  if (exact) return exact;
  const sorted = [...days]
    .filter((d) => Number.isFinite(Number(d?.day)))
    .sort((a, b) => Number(a.day) - Number(b.day));
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (Number(sorted[i].day) <= currentDay) return sorted[i];
  }
  return sorted[0] || null;
}

function classifyStage(stageName, currentDay) {
  const stage = String(stageName || '').trim().toLowerCase();
  // Order MUST match the UI's determineGroupStage()
  // (public/views/nutrient-management.html around line 2399): earlyFlowering is
  // tested before heavyFruiting so ambiguous names like "early fruit" or
  // "heavy flowering" classify the same way on both sides. If the two diverge,
  // reconcileRecipeNutrientTargets() will emit spurious drift alerts.
  if (currentDay <= 14) return 'establishment';
  if (EARLY_FLOWERING_RX.test(stage)) return 'earlyFlowering';
  if (HEAVY_FRUITING_RX.test(stage)) return 'heavyFruiting';
  if (FRUITING_STAGE_RX.test(stage)) return 'earlyFlowering';
  return 'vegetative';
}

function isFruitingStage(stageName) {
  return FRUITING_STAGE_RX.test(String(stageName || ''));
}

function resolveGroupTargets(group, { now = new Date(), ecTargets = DEFAULT_EC_TARGETS, phTargets = DEFAULT_PH_TARGETS } = {}) {
  const days = group?.plan?.days;
  const currentDay = calculateCurrentDay(group, now);
  const planDay = findScheduleDay(days, currentDay);

  const recipeEc = toFiniteNumber(planDay?.ec);
  const recipePh = toFiniteNumber(planDay?.ph);
  const stageName = planDay?.stage || '';
  const ecStage = classifyStage(stageName, currentDay);

  const ec = recipeEc != null ? recipeEc : (ecTargets[ecStage] ?? ecTargets.vegetative);
  const ph = recipePh != null ? recipePh : (phTargets[ecStage] ?? phTargets.vegetative);

  return {
    groupId: group?.id || null,
    name: group?.name || group?.label || '(unnamed)',
    crop: group?.crop || group?.plan?.name || '',
    day: currentDay,
    stage: stageName,
    ecStage,
    ec: toFiniteNumber(ec),
    ph: toFiniteNumber(ph),
    fromRecipe: recipeEc != null || recipePh != null,
    isFruiting: isFruitingStage(stageName),
    weight: Number.isFinite(Number(group?.planted_site_count))
      ? Number(group.planted_site_count)
      : Array.isArray(group?.members) ? group.members.length : 1
  };
}

function weightedAverage(values) {
  let sum = 0;
  let weight = 0;
  for (const v of values) {
    const val = toFiniteNumber(v?.value);
    // Use ?? not || so a legitimate weight of 0 (e.g. planted_site_count = 0 on
    // a group that's been set up but not yet seeded) stays 0 instead of being
    // inflated to 1 and skewing the weighted average.
    const w = toFiniteNumber(v?.weight) ?? 1;
    if (val == null) continue;
    sum += val * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

function maxOf(values) {
  let best = null;
  for (const v of values) {
    const val = toFiniteNumber(v?.value);
    if (val == null) continue;
    if (best == null || val > best) best = val;
  }
  return best;
}

function aggregate(resolved, key, aggregator) {
  const values = resolved.map((r) => ({ value: r[key], weight: r.weight }));
  return aggregator === 'max' ? maxOf(values) : weightedAverage(values);
}

// Default 2-tank configuration (backward compatible). Callers can supply
// opts.tankConfig to override with N tanks.
const DEFAULT_TANK_CONFIG = [
  { id: 'tank1', scopeId: 'tank-1', name: 'Tank 1 - Vegetative', filter: (r) => !r.isFruiting, fallbackStage: 'vegetative' },
  { id: 'tank2', scopeId: 'tank-2', name: 'Tank 2 - Fruiting',   filter: (r) => r.isFruiting,  fallbackStage: 'earlyFlowering' },
];

/**
 * Resolve nutrient targets for all configured tanks from the supplied enriched groups.
 *
 * @param {Array<Object>} groups           Enriched groups (with plan.days[])
 * @param {Object}        [opts]
 * @param {Date}          [opts.now]       Reference time (defaults to new Date())
 * @param {'weighted'|'max'} [opts.aggregator] Aggregation strategy (default: weighted)
 * @param {Object}        [opts.ecTargets] Overrides for fallback EC stage table
 * @param {Object}        [opts.phTargets] Overrides for fallback pH stage table
 * @param {Array}         [opts.tankConfig] Tank definitions (default: DEFAULT_TANK_CONFIG)
 * @returns {{
 *   tanks: { [tankId]: { ec, ph, sources, reason } },
 *   tank1: ..., tank2: ...,                            // backward compat aliases
 *   calculatedAt: string,
 *   aggregator: string
 * }}
 */
function resolveTankTargets(groups, opts = {}) {
  const { now = new Date(), aggregator = 'weighted' } = opts;
  const tankConfig = opts.tankConfig || DEFAULT_TANK_CONFIG;
  const list = Array.isArray(groups) ? groups : [];
  const resolved = list
    .filter((g) => g && g.plan && Array.isArray(g.plan.days) && g.plan.days.length > 0)
    .map((g) => resolveGroupTargets(g, { now, ecTargets: opts.ecTargets, phTargets: opts.phTargets }));

  const build = (sources, fallbackStage) => {
    if (sources.length === 0) {
      return {
        ec: (opts.ecTargets || DEFAULT_EC_TARGETS)[fallbackStage] ?? DEFAULT_EC_TARGETS[fallbackStage],
        ph: (opts.phTargets || DEFAULT_PH_TARGETS)[fallbackStage] ?? DEFAULT_PH_TARGETS[fallbackStage],
        sources: [],
        reason: 'no-active-groups'
      };
    }
    return {
      ec: aggregate(sources, 'ec', aggregator),
      ph: aggregate(sources, 'ph', aggregator),
      sources,
      reason: sources.some((s) => s.fromRecipe) ? 'recipe' : 'fallback-default'
    };
  };

  const tanks = {};
  const assigned = new Set();
  for (const tc of tankConfig) {
    const sources = resolved.filter((r) => {
      if (assigned.has(r.groupId)) return false;
      return tc.filter ? tc.filter(r) : true;
    });
    sources.forEach((s) => assigned.add(s.groupId));
    tanks[tc.id] = build(sources, tc.fallbackStage || 'vegetative');
  }
  // Assign any unmatched groups to the first tank
  const unmatched = resolved.filter((r) => !assigned.has(r.groupId));
  if (unmatched.length > 0 && tankConfig.length > 0) {
    const firstId = tankConfig[0].id;
    tanks[firstId].sources = [...tanks[firstId].sources, ...unmatched];
    if (unmatched.length > 0) {
      tanks[firstId].ec = aggregate(tanks[firstId].sources, 'ec', aggregator) ?? tanks[firstId].ec;
      tanks[firstId].ph = aggregate(tanks[firstId].sources, 'ph', aggregator) ?? tanks[firstId].ph;
      if (tanks[firstId].sources.length > 0) {
        tanks[firstId].reason = tanks[firstId].sources.some((s) => s.fromRecipe) ? 'recipe' : 'fallback-default';
      }
    }
  }

  const result = {
    tanks,
    calculatedAt: now.toISOString(),
    aggregator
  };
  // Backward compatibility: expose tank1/tank2 as top-level aliases
  if (tanks.tank1) result.tank1 = tanks.tank1;
  if (tanks.tank2) result.tank2 = tanks.tank2;
  return result;
}

/**
 * Diff two {ec, ph} targets. Returns { ec: {from,to,delta}, ph: {...}, changed: bool }.
 * Tolerances default to 0.05 mS/cm for EC and 0.05 pH units \u2014 below these the diff is
 * treated as noise (no drift).
 */
function diffTargets(applied, resolved, { ecTolerance = 0.05, phTolerance = 0.05 } = {}) {
  const fromEc = toFiniteNumber(applied?.ec);
  const toEc = toFiniteNumber(resolved?.ec);
  const fromPh = toFiniteNumber(applied?.ph);
  const toPh = toFiniteNumber(resolved?.ph);
  const ecDelta = (fromEc != null && toEc != null) ? toEc - fromEc : null;
  const phDelta = (fromPh != null && toPh != null) ? toPh - fromPh : null;
  const ecChanged = ecDelta != null && Math.abs(ecDelta) > ecTolerance;
  const phChanged = phDelta != null && Math.abs(phDelta) > phTolerance;
  return {
    ec: { from: fromEc, to: toEc, delta: ecDelta, changed: ecChanged },
    ph: { from: fromPh, to: toPh, delta: phDelta, changed: phChanged },
    changed: ecChanged || phChanged
  };
}

export {
  resolveTankTargets,
  DEFAULT_TANK_CONFIG,
  resolveGroupTargets,
  diffTargets,
  calculateCurrentDay,
  findScheduleDay,
  classifyStage,
  isFruitingStage,
  DEFAULT_EC_TARGETS,
  DEFAULT_PH_TARGETS
};
