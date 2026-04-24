/**
 * Grow Systems Template Validator
 *
 * Audits greenreach-central/public/data/grow-systems.json (and the mirror at
 * public/data/grow-systems.json) for structural correctness and internal
 * consistency before the values are handed to EVIE, the 3D viewer, or the
 * layout optimizer.
 *
 * Checks (per template):
 *   - required: id, name, category, footprintM.length, footprintM.width, heightM
 *   - dimensions are finite, positive numbers
 *   - tierCount / traysPerTier are positive integers when present
 *   - plantLocations.totalByClass values are positive integers
 *   - authoritative plantLocations vs. derived (tierCount * traysPerTier *
 *     plantsPerTrayByClass[crop]) — warn when the ratio is outside
 *     [MIN_RATIO, MAX_RATIO]
 *   - spatialContract.workspaceClearanceM entries are non-negative
 *   - power fields (powerClassW, irrigation pump fields) are non-negative
 *   - heightM is less than typical room ceilings (3.5m). Templates taller than
 *     3.0m get a headroom warning so the UI can surface it.
 *
 * Returns: { ok, errors[], warnings[], summary }
 * Use at startup to log findings; use per-request inside tools to early-exit
 * if a specific template id is structurally broken.
 */

const REQUIRED_FIELDS = ['id', 'name', 'category', 'footprintM', 'heightM'];
const REQUIRED_FOOTPRINT_FIELDS = ['length', 'width'];
const MIN_AUTH_VS_DERIVED_RATIO = 0.25; // authoritative count should not be <25% of derived
const MAX_AUTH_VS_DERIVED_RATIO = 4.0;  // or >400% -- almost certainly a typo
const HEADROOM_WARNING_M = 3.0;         // templates taller than this need a warning
const MAX_SANE_DIMENSION_M = 50;        // anything >50m is almost certainly a unit error

function isPositiveFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validateTemplate(template, index) {
  const errors = [];
  const warnings = [];
  const id = template && template.id ? template.id : `(index ${index})`;

  if (!template || typeof template !== 'object') {
    errors.push(`Template ${id}: not an object`);
    return { errors, warnings };
  }

  for (const field of REQUIRED_FIELDS) {
    if (template[field] == null) {
      errors.push(`Template ${id}: missing required field "${field}"`);
    }
  }

  if (template.footprintM && typeof template.footprintM === 'object') {
    for (const f of REQUIRED_FOOTPRINT_FIELDS) {
      if (!isPositiveFiniteNumber(template.footprintM[f])) {
        errors.push(`Template ${id}: footprintM.${f} must be a positive number (saw ${template.footprintM[f]})`);
      } else if (template.footprintM[f] > MAX_SANE_DIMENSION_M) {
        warnings.push(`Template ${id}: footprintM.${f} = ${template.footprintM[f]}m looks like a unit error (expected metres)`);
      }
    }
  }

  if (!isPositiveFiniteNumber(template.heightM)) {
    errors.push(`Template ${id}: heightM must be a positive number (saw ${template.heightM})`);
  } else if (template.heightM > MAX_SANE_DIMENSION_M) {
    warnings.push(`Template ${id}: heightM = ${template.heightM}m looks like a unit error (expected metres)`);
  } else if (template.heightM > HEADROOM_WARNING_M) {
    warnings.push(`Template ${id}: heightM = ${template.heightM}m is taller than typical room ceilings; verify room.ceiling_height_m before use`);
  }

  if (template.tierCount != null && !isPositiveInteger(template.tierCount)) {
    errors.push(`Template ${id}: tierCount must be a positive integer (saw ${template.tierCount})`);
  }
  if (template.traysPerTier != null && !isPositiveInteger(template.traysPerTier)) {
    errors.push(`Template ${id}: traysPerTier must be a positive integer (saw ${template.traysPerTier})`);
  }

  // Authoritative vs derived plant count sanity check.
  // Skipped when source === 'manual_override' (the template author explicitly
  // certified the count -- we trust it and do not second-guess).
  const tiers = template.tierCount;
  const traysPerTier = template.traysPerTier;
  const plantsByClassAuth = template.plantLocations?.totalByClass || {};
  const plantsPerTrayByClass = template.plantsPerTrayByClass || {};
  const plantCountSource = template.plantLocations?.source || null;
  const skipDerivedCheck = plantCountSource === 'manual_override';

  for (const [cropClass, authCount] of Object.entries(plantsByClassAuth)) {
    if (!isPositiveInteger(authCount)) {
      errors.push(`Template ${id}: plantLocations.totalByClass.${cropClass} must be a positive integer (saw ${authCount})`);
      continue;
    }
    if (skipDerivedCheck) continue;
    const perTray = plantsPerTrayByClass[cropClass];
    if (isPositiveInteger(tiers) && isPositiveInteger(traysPerTier) && isPositiveInteger(perTray)) {
      const derived = tiers * traysPerTier * perTray;
      const ratio = authCount / derived;
      if (ratio < MIN_AUTH_VS_DERIVED_RATIO || ratio > MAX_AUTH_VS_DERIVED_RATIO) {
        warnings.push(
          `Template ${id}: authoritative ${cropClass} plant count (${authCount}) ` +
          `differs from derived (${tiers}*${traysPerTier}*${perTray}=${derived}) ` +
          `by ratio ${ratio.toFixed(2)}. Verify plantLocations.totalByClass.`
        );
      }
    }
  }

  // Workspace clearances must be non-negative when present.
  const clearance = template.spatialContract?.workspaceClearanceM;
  if (clearance && typeof clearance === 'object') {
    for (const [side, val] of Object.entries(clearance)) {
      if (val != null && !isNonNegativeFiniteNumber(val)) {
        errors.push(`Template ${id}: spatialContract.workspaceClearanceM.${side} must be >= 0 (saw ${val})`);
      }
    }
  }

  // Power fields must be non-negative when present.
  const irr = template.irrigation || {};
  for (const pumpField of ['supplyPumpWattsPer10kPlants', 'returnPumpWattsPer10kPlants']) {
    if (irr[pumpField] != null && !isNonNegativeFiniteNumber(irr[pumpField])) {
      errors.push(`Template ${id}: irrigation.${pumpField} must be >= 0 (saw ${irr[pumpField]})`);
    }
  }
  const power = template.powerClassW || {};
  for (const [k, v] of Object.entries(power)) {
    // Skip metadata fields (strings, arrays, nested objects) so authors can
    // document exceptions next to the numeric values.
    if (typeof v !== 'number') continue;
    if (!isNonNegativeFiniteNumber(v)) {
      errors.push(`Template ${id}: powerClassW.${k} must be >= 0 (saw ${v})`);
    }
  }

  return { errors, warnings };
}

/**
 * Validate a parsed grow-systems.json document.
 * @param {object} doc  parsed JSON
 * @returns {{ok: boolean, errors: string[], warnings: string[], summary: object}}
 */
export function validateGrowSystems(doc) {
  const errors = [];
  const warnings = [];

  if (!doc || typeof doc !== 'object') {
    return {
      ok: false,
      errors: ['grow-systems.json is not a JSON object'],
      warnings: [],
      summary: { template_count: 0 }
    };
  }

  if (!Array.isArray(doc.templates)) {
    return {
      ok: false,
      errors: ['grow-systems.json is missing the "templates" array'],
      warnings: [],
      summary: { template_count: 0 }
    };
  }

  const seenIds = new Set();
  for (let i = 0; i < doc.templates.length; i++) {
    const t = doc.templates[i];
    const result = validateTemplate(t, i);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
    if (t && t.id) {
      if (seenIds.has(t.id)) {
        errors.push(`Template id "${t.id}" appears more than once`);
      }
      seenIds.add(t.id);
    }
  }

  const summary = {
    template_count: doc.templates.length,
    unique_ids: seenIds.size,
    error_count: errors.length,
    warning_count: warnings.length,
    schema_version: doc.schemaVersion || null,
    version: doc.version || null
  };

  return { ok: errors.length === 0, errors, warnings, summary };
}

export default { validateGrowSystems };
