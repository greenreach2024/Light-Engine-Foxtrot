/**
 * Recipe Modifier System — Phase 3, Ticket 3.1
 *
 * After 10+ experiment records for a crop at this farm, compute per-crop
 * recipe offsets (±5% max per parameter: spectrum ratio, PPFD, temp).
 * Stored in data/recipe-modifiers.json.
 * Applied between the plan resolver and the spectral solver in the daily loop.
 *
 * Also supports champion/challenger evaluation (Ticket 3.5):
 * when a modifier is applied to one group but not another growing the same crop,
 * outcomes are compared and delta reported.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODIFIERS_PATH = path.join(__dirname, '..', 'data', 'recipe-modifiers.json');

// Hard limits: ±5% per parameter
const MAX_OFFSET_PCT = 5;

/**
 * Load the current modifiers file (or empty if none).
 * @returns {{ modifiers: Record<string, CropModifier>, computed_at: string, version: number }}
 */
export function loadModifiers() {
  try {
    const raw = fs.readFileSync(MODIFIERS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { modifiers: {}, computed_at: null, version: 0 };
  }
}

/**
 * Persist modifiers to disk.
 */
export function saveModifiers(data) {
  fs.writeFileSync(MODIFIERS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Clamp a percentage offset to ±MAX_OFFSET_PCT.
 */
function clampOffset(val) {
  return Math.max(-MAX_OFFSET_PCT, Math.min(MAX_OFFSET_PCT, val));
}

/**
 * Compute recipe modifiers from experiment records.
 * Called periodically (weekly or after new experiment records).
 *
 * Algorithm:
 *   For each crop with >= minRecords experiment records:
 *   1. Compute baseline averages (recipe_params_avg) and outcome averages
 *   2. Identify the top-performing records (top 25% by weight_per_plant_oz)
 *   3. Compute delta between top-performer recipe params and overall average
 *   4. Clamp to ±5%
 *
 * @param {Array} experimentRecords - array of experiment record objects
 * @param {number} [minRecords=10] - minimum records per crop to compute
 * @returns {{ modifiers: Record<string, object>, computed_at: string }}
 */
export function computeModifiers(experimentRecords, minRecords = 10) {
  const byCrop = {};
  for (const rec of experimentRecords) {
    const crop = (rec.crop || '').toLowerCase().replace(/\s+/g, '-');
    if (!crop) continue;
    if (!byCrop[crop]) byCrop[crop] = [];
    byCrop[crop].push(rec);
  }

  const modifiers = {};
  for (const [crop, records] of Object.entries(byCrop)) {
    if (records.length < minRecords) continue;

    // Filter records with valid outcome data
    const valid = records.filter(r =>
      r.outcomes?.weight_per_plant_oz != null &&
      r.recipe_params_avg?.ppfd != null
    );
    if (valid.length < minRecords) continue;

    // Compute overall averages
    const avg = computeAverages(valid);

    // Top 25% performers by weight per plant
    const sorted = [...valid].sort((a, b) =>
      (b.outcomes.weight_per_plant_oz || 0) - (a.outcomes.weight_per_plant_oz || 0)
    );
    const topCount = Math.max(1, Math.floor(sorted.length * 0.25));
    const topPerformers = sorted.slice(0, topCount);
    const topAvg = computeAverages(topPerformers);

    // Compute offsets as percentage deltas from overall average
    const ppfdOffset = avg.ppfd > 0
      ? clampOffset(((topAvg.ppfd - avg.ppfd) / avg.ppfd) * 100)
      : 0;
    const bluePctOffset = avg.blue_pct > 0
      ? clampOffset(topAvg.blue_pct - avg.blue_pct)
      : 0;
    const redPctOffset = avg.red_pct > 0
      ? clampOffset(topAvg.red_pct - avg.red_pct)
      : 0;
    const tempOffset = avg.temp_c > 0
      ? clampOffset(((topAvg.temp_c - avg.temp_c) / avg.temp_c) * 100)
      : 0;

    // Confidence: higher with more records and clearer separation
    const recordBonus = Math.min(1, valid.length / 50); // max at 50 records
    const separationBonus = topAvg.weight > 0 && avg.weight > 0
      ? Math.min(1, (topAvg.weight - avg.weight) / avg.weight * 5)
      : 0;
    const confidence = +(Math.min(1, 0.3 + recordBonus * 0.4 + separationBonus * 0.3)).toFixed(2);

    modifiers[crop] = {
      ppfd_offset_pct: +ppfdOffset.toFixed(2),
      blue_pct_offset: +bluePctOffset.toFixed(2),
      red_pct_offset: +redPctOffset.toFixed(2),
      temp_offset_pct: +tempOffset.toFixed(2),
      confidence,
      record_count: valid.length,
      top_performer_count: topCount,
      avg_weight_per_plant_oz: +avg.weight.toFixed(3),
      top_avg_weight_per_plant_oz: +topAvg.weight.toFixed(3),
      computed_at: new Date().toISOString()
    };
  }

  const result = {
    modifiers,
    computed_at: new Date().toISOString(),
    version: (loadModifiers().version || 0) + 1
  };
  saveModifiers(result);
  console.log(`[recipe-modifier] Computed modifiers for ${Object.keys(modifiers).length} crops`);
  return result;
}

function computeAverages(records) {
  let ppfdSum = 0, blueSum = 0, redSum = 0, tempSum = 0, weightSum = 0;
  let ppfdN = 0, blueN = 0, redN = 0, tempN = 0, weightN = 0;
  for (const r of records) {
    const p = r.recipe_params_avg || {};
    if (p.ppfd != null) { ppfdSum += p.ppfd; ppfdN++; }
    if (p.blue_pct != null) { blueSum += p.blue_pct; blueN++; }
    if (p.red_pct != null) { redSum += p.red_pct; redN++; }
    if (p.temp_c != null) { tempSum += p.temp_c; tempN++; }
    if (r.outcomes?.weight_per_plant_oz != null) {
      weightSum += r.outcomes.weight_per_plant_oz;
      weightN++;
    }
  }
  return {
    ppfd: ppfdN > 0 ? ppfdSum / ppfdN : 0,
    blue_pct: blueN > 0 ? blueSum / blueN : 0,
    red_pct: redN > 0 ? redSum / redN : 0,
    temp_c: tempN > 0 ? tempSum / tempN : 0,
    weight: weightN > 0 ? weightSum / weightN : 0
  };
}

/**
 * Apply a crop's modifier offsets to resolved recipe targets.
 * Called in the daily resolver loop between plan resolve and spectrum solver.
 *
 * @param {string} crop - crop name (lowercase, hyphenated)
 * @param {{ ppfd: number|null, mix: object, envTempC: number|null }} targets
 * @returns {{ ppfd: number|null, mix: object, envTempC: number|null, modifierApplied: boolean, modifierDetails: object|null }}
 */
export function applyModifier(crop, targets) {
  const data = loadModifiers();
  const cropKey = (crop || '').toLowerCase().replace(/\s+/g, '-');
  const mod = data.modifiers?.[cropKey];

  if (!mod || mod.confidence < 0.4) {
    return { ...targets, modifierApplied: false, modifierDetails: null };
  }

  let ppfd = targets.ppfd;
  if (ppfd != null && mod.ppfd_offset_pct) {
    ppfd = +(ppfd * (1 + mod.ppfd_offset_pct / 100)).toFixed(1);
  }

  // Adjust spectral ratios in mix if present
  const mix = { ...(targets.mix || {}) };
  if (mod.blue_pct_offset && (mix.blue != null || mix.bl != null)) {
    const key = mix.blue != null ? 'blue' : 'bl';
    mix[key] = +(mix[key] + mod.blue_pct_offset).toFixed(1);
  }
  if (mod.red_pct_offset && (mix.red != null || mix.rd != null)) {
    const key = mix.red != null ? 'red' : 'rd';
    mix[key] = +(mix[key] + mod.red_pct_offset).toFixed(1);
  }

  let envTempC = targets.envTempC;
  if (envTempC != null && mod.temp_offset_pct) {
    envTempC = +(envTempC * (1 + mod.temp_offset_pct / 100)).toFixed(1);
  }

  return {
    ppfd,
    mix,
    envTempC,
    modifierApplied: true,
    modifierDetails: {
      crop: cropKey,
      ppfd_offset_pct: mod.ppfd_offset_pct,
      blue_pct_offset: mod.blue_pct_offset,
      red_pct_offset: mod.red_pct_offset,
      temp_offset_pct: mod.temp_offset_pct,
      confidence: mod.confidence,
      record_count: mod.record_count
    }
  };
}

// ── Ticket 3.5: Champion/Challenger Evaluation ──────────────────────────
// Track which groups have modifiers applied vs baseline (same crop, no modifier).

/**
 * Record a champion/challenger observation.
 * Called from the harvest handler when an experiment record is created.
 *
 * @param {object} opts
 * @param {string} opts.crop
 * @param {string} opts.groupId
 * @param {boolean} opts.modifierApplied
 * @param {object} opts.modifierDetails - from applyModifier() or null
 * @param {object} opts.outcomes - { weight_per_plant_oz, quality_score, loss_rate }
 * @param {object} [opts.auditDB] - NeDB store for persistent logging
 * @returns {Promise<object|null>}
 */
export async function recordChampionChallenger(opts) {
  const { crop, groupId, modifierApplied, modifierDetails, outcomes, auditDB } = opts;
  if (!auditDB) return null;

  const entry = {
    type: 'champion_challenger',
    crop: (crop || '').toLowerCase().replace(/\s+/g, '-'),
    group_id: groupId,
    variant: modifierApplied ? 'champion' : 'challenger',
    modifier_details: modifierDetails || null,
    outcomes: {
      weight_per_plant_oz: outcomes?.weight_per_plant_oz ?? null,
      quality_score: outcomes?.quality_score ?? null,
      loss_rate: outcomes?.loss_rate ?? null
    },
    recorded_at: new Date().toISOString()
  };

  try {
    const inserted = await auditDB.insert(entry);
    console.log(`[champion/challenger] Recorded ${entry.variant} for ${entry.crop} group ${groupId}`);
    return inserted;
  } catch (err) {
    console.error('[champion/challenger] Failed to record:', err.message);
    return null;
  }
}

/**
 * Compare champion (modifier applied) vs challenger (baseline) for a crop.
 *
 * @param {object} auditDB - NeDB store
 * @param {string} crop
 * @returns {Promise<object>}
 */
export async function compareChampionChallenger(auditDB, crop) {
  if (!auditDB) return { error: 'no_audit_db' };
  const cropKey = (crop || '').toLowerCase().replace(/\s+/g, '-');

  const records = await auditDB.find({ type: 'champion_challenger', crop: cropKey });
  const champions = records.filter(r => r.variant === 'champion');
  const challengers = records.filter(r => r.variant === 'challenger');

  if (champions.length === 0 || challengers.length === 0) {
    return {
      crop: cropKey,
      sufficient_data: false,
      champion_count: champions.length,
      challenger_count: challengers.length,
      message: 'Need both champion and challenger records for comparison'
    };
  }

  const champAvg = avgOutcomes(champions);
  const challAvg = avgOutcomes(challengers);

  const weightDelta = champAvg.weight > 0 && challAvg.weight > 0
    ? +((champAvg.weight - challAvg.weight) / challAvg.weight * 100).toFixed(1)
    : null;
  const qualityDelta = champAvg.quality != null && challAvg.quality != null
    ? +(champAvg.quality - challAvg.quality).toFixed(1)
    : null;
  const lossDelta = champAvg.loss != null && challAvg.loss != null
    ? +(challAvg.loss - champAvg.loss).toFixed(3) // positive = champion has lower loss
    : null;

  return {
    crop: cropKey,
    sufficient_data: true,
    champion_count: champions.length,
    challenger_count: challengers.length,
    champion_avg: champAvg,
    challenger_avg: challAvg,
    deltas: {
      weight_pct: weightDelta,
      quality_score: qualityDelta,
      loss_rate_reduction: lossDelta
    },
    verdict: weightDelta != null && weightDelta > 2
      ? 'champion_winning'
      : weightDelta != null && weightDelta < -2
        ? 'challenger_winning'
        : 'no_significant_difference'
  };
}

function avgOutcomes(records) {
  let wSum = 0, wN = 0, qSum = 0, qN = 0, lSum = 0, lN = 0;
  for (const r of records) {
    const o = r.outcomes || {};
    if (o.weight_per_plant_oz != null) { wSum += o.weight_per_plant_oz; wN++; }
    if (o.quality_score != null) { qSum += o.quality_score; qN++; }
    if (o.loss_rate != null) { lSum += o.loss_rate; lN++; }
  }
  return {
    weight: wN > 0 ? +(wSum / wN).toFixed(3) : null,
    quality: qN > 0 ? +(qSum / qN).toFixed(1) : null,
    loss: lN > 0 ? +(lSum / lN).toFixed(3) : null
  };
}

// ── Ticket 5.1: Constrained Autonomous Recipe Adjustment ────────────────
// Auto-apply modifiers within guardrail bounds without grower approval.
// Auto-revert if 2 consecutive cycles underperform baseline.
// All autonomous actions logged to audit DB.

const AUTONOMOUS_BOUNDS = {
  max_ppfd_offset_pct: 5,      // ±5% PPFD
  max_temp_offset_c: 1,        // ±1°C temperature
  max_spectrum_offset_pct: 5,  // ±5% spectral shift
  max_ppfd_absolute: 15,       // ±15 PPFD absolute
  min_confidence: 0.6,         // Higher confidence threshold for autonomous
  min_records: 15              // More records required for autonomous
};

const REVERT_TRACKER_PATH = path.join(__dirname, '..', 'data', 'recipe-revert-tracker.json');

function loadRevertTracker() {
  try {
    return JSON.parse(fs.readFileSync(REVERT_TRACKER_PATH, 'utf-8'));
  } catch {
    return { crops: {} };
  }
}

function saveRevertTracker(data) {
  fs.writeFileSync(REVERT_TRACKER_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Check if a modifier is within autonomous application bounds.
 * Stricter than the base ±5% guardrails for unattended operation.
 */
export function isWithinAutonomousBounds(mod) {
  if (!mod) return false;
  if (mod.confidence < AUTONOMOUS_BOUNDS.min_confidence) return false;
  if (mod.record_count < AUTONOMOUS_BOUNDS.min_records) return false;
  if (Math.abs(mod.ppfd_offset_pct || 0) > AUTONOMOUS_BOUNDS.max_ppfd_offset_pct) return false;
  if (Math.abs(mod.temp_offset_pct || 0) > AUTONOMOUS_BOUNDS.max_spectrum_offset_pct) return false;
  if (Math.abs(mod.blue_pct_offset || 0) > AUTONOMOUS_BOUNDS.max_spectrum_offset_pct) return false;
  if (Math.abs(mod.red_pct_offset || 0) > AUTONOMOUS_BOUNDS.max_spectrum_offset_pct) return false;
  return true;
}

/**
 * Autonomously apply modifier if within bounds.
 * Logs all autonomous actions to audit DB.
 * Returns { applied, reverted, reason, targets, auditEntry }
 *
 * @param {string} crop
 * @param {{ ppfd: number|null, mix: object, envTempC: number|null }} targets
 * @param {object} [auditDB] - NeDB audit store
 * @param {string} [farmId] - farm identifier for audit log
 */
export async function autonomousApplyModifier(crop, targets, auditDB, farmId) {
  const data = loadModifiers();
  const cropKey = (crop || '').toLowerCase().replace(/\s+/g, '-');
  const mod = data.modifiers?.[cropKey];

  // Check revert status first
  const tracker = loadRevertTracker();
  const cropTracker = tracker.crops?.[cropKey];
  if (cropTracker?.reverted && !cropTracker?.cleared) {
    const entry = {
      type: 'autonomous_recipe',
      action: 'skip_reverted',
      crop: cropKey,
      farm_id: farmId || 'unknown',
      reason: 'Modifier reverted due to underperformance — manual review required',
      reverted_at: cropTracker.reverted_at,
      timestamp: new Date().toISOString()
    };
    if (auditDB) await auditDB.insert(entry).catch(() => {});
    return { applied: false, reverted: true, reason: 'reverted_awaiting_review', targets, auditEntry: entry };
  }

  if (!mod) {
    return { applied: false, reverted: false, reason: 'no_modifier', targets, auditEntry: null };
  }

  if (!isWithinAutonomousBounds(mod)) {
    const entry = {
      type: 'autonomous_recipe',
      action: 'skip_out_of_bounds',
      crop: cropKey,
      farm_id: farmId || 'unknown',
      modifier: mod,
      bounds: AUTONOMOUS_BOUNDS,
      reason: 'Modifier exceeds autonomous bounds — requires grower approval',
      timestamp: new Date().toISOString()
    };
    if (auditDB) await auditDB.insert(entry).catch(() => {});
    return { applied: false, reverted: false, reason: 'out_of_bounds', targets, auditEntry: entry };
  }

  // Apply the modifier
  const result = applyModifier(crop, targets);

  const entry = {
    type: 'autonomous_recipe',
    action: 'auto_applied',
    agent_class: 'grow-advisor',
    action_type: 'auto_apply_recipe',
    crop: cropKey,
    farm_id: farmId || 'unknown',
    human_decision: 'auto',
    tier: 'auto',
    original_targets: { ppfd: targets.ppfd, envTempC: targets.envTempC },
    modified_targets: { ppfd: result.ppfd, envTempC: result.envTempC },
    modifier_details: result.modifierDetails,
    confidence: mod.confidence,
    record_count: mod.record_count,
    timestamp: new Date().toISOString()
  };
  if (auditDB) await auditDB.insert(entry).catch(() => {});

  console.log(`[autonomous-recipe] Auto-applied modifier for ${cropKey} (confidence: ${mod.confidence}, records: ${mod.record_count})`);
  return { applied: true, reverted: false, reason: 'auto_applied', targets: result, auditEntry: entry };
}

/**
 * Record a harvest outcome for auto-revert tracking.
 * If 2 consecutive cycles underperform baseline, revert the modifier.
 *
 * @param {string} crop
 * @param {object} outcomes - { weight_per_plant_oz, quality_score }
 * @param {object} [auditDB]
 * @param {string} [farmId]
 * @returns {{ reverted: boolean, reason: string }}
 */
export async function trackAutonomousPerformance(crop, outcomes, auditDB, farmId) {
  const cropKey = (crop || '').toLowerCase().replace(/\s+/g, '-');
  const data = loadModifiers();
  const mod = data.modifiers?.[cropKey];
  if (!mod) return { reverted: false, reason: 'no_modifier' };

  const tracker = loadRevertTracker();
  if (!tracker.crops[cropKey]) {
    tracker.crops[cropKey] = { cycles: [], reverted: false };
  }

  const baseline = mod.avg_weight_per_plant_oz || 0;
  const currentWeight = outcomes?.weight_per_plant_oz || 0;
  const underperformed = baseline > 0 && currentWeight < baseline * 0.95; // 5% tolerance

  tracker.crops[cropKey].cycles.push({
    weight: currentWeight,
    baseline,
    underperformed,
    quality_score: outcomes?.quality_score ?? null,
    recorded_at: new Date().toISOString()
  });

  // Keep only last 5 cycles
  if (tracker.crops[cropKey].cycles.length > 5) {
    tracker.crops[cropKey].cycles = tracker.crops[cropKey].cycles.slice(-5);
  }

  // Check for 2 consecutive underperformances
  const cycles = tracker.crops[cropKey].cycles;
  const lastTwo = cycles.slice(-2);
  const consecutiveUnderperformance = lastTwo.length === 2 &&
    lastTwo.every(c => c.underperformed);

  if (consecutiveUnderperformance && !tracker.crops[cropKey].reverted) {
    // Auto-revert: remove the modifier
    tracker.crops[cropKey].reverted = true;
    tracker.crops[cropKey].reverted_at = new Date().toISOString();
    tracker.crops[cropKey].cleared = false;
    saveRevertTracker(tracker);

    // Remove the modifier from active modifiers
    if (data.modifiers[cropKey]) {
      data.modifiers[cropKey].reverted = true;
      data.modifiers[cropKey].reverted_at = new Date().toISOString();
      saveModifiers(data);
    }

    const entry = {
      type: 'autonomous_recipe',
      action: 'auto_reverted',
      agent_class: 'grow-advisor',
      crop: cropKey,
      farm_id: farmId || 'unknown',
      reason: '2 consecutive cycles underperformed baseline',
      baseline_weight: baseline,
      last_two_weights: lastTwo.map(c => c.weight),
      timestamp: new Date().toISOString()
    };
    if (auditDB) await auditDB.insert(entry).catch(() => {});

    console.log(`[autonomous-recipe] AUTO-REVERTED modifier for ${cropKey}: 2 consecutive underperformances (${lastTwo.map(c => c.weight.toFixed(2)).join(', ')} vs baseline ${baseline.toFixed(2)})`);
    return { reverted: true, reason: 'consecutive_underperformance' };
  }

  saveRevertTracker(tracker);
  return { reverted: false, reason: 'tracking' };
}

/**
 * Clear a revert flag after manual review, allowing autonomous re-application.
 */
export function clearRevert(crop) {
  const cropKey = (crop || '').toLowerCase().replace(/\s+/g, '-');
  const tracker = loadRevertTracker();
  if (tracker.crops[cropKey]) {
    tracker.crops[cropKey].reverted = false;
    tracker.crops[cropKey].cleared = true;
    tracker.crops[cropKey].cleared_at = new Date().toISOString();
    tracker.crops[cropKey].cycles = [];
    saveRevertTracker(tracker);
  }

  // Also clear reverted flag on the modifier
  const data = loadModifiers();
  if (data.modifiers[cropKey]?.reverted) {
    delete data.modifiers[cropKey].reverted;
    delete data.modifiers[cropKey].reverted_at;
    saveModifiers(data);
  }

  console.log(`[autonomous-recipe] Cleared revert for ${cropKey}`);
  return { cleared: true, crop: cropKey };
}

/**
 * Get autonomous status for all crops.
 */
export function getAutonomousStatus() {
  const data = loadModifiers();
  const tracker = loadRevertTracker();
  const status = {};

  for (const [crop, mod] of Object.entries(data.modifiers || {})) {
    const cropTracker = tracker.crops?.[crop] || {};
    status[crop] = {
      has_modifier: true,
      within_bounds: isWithinAutonomousBounds(mod),
      confidence: mod.confidence,
      record_count: mod.record_count,
      reverted: cropTracker.reverted || false,
      recent_cycles: (cropTracker.cycles || []).slice(-3),
      auto_eligible: isWithinAutonomousBounds(mod) && !cropTracker.reverted
    };
  }
  return status;
}

export default {
  loadModifiers,
  saveModifiers,
  computeModifiers,
  applyModifier,
  recordChampionChallenger,
  compareChampionChallenger,
  autonomousApplyModifier,
  trackAutonomousPerformance,
  isWithinAutonomousBounds,
  clearRevert,
  getAutonomousStatus
};
