/**
 * A/B Recipe Experiment Orchestrator — Phase 4, Ticket 4.7
 *
 * Central assigns spectrum experiment parameters to specific farms/groups.
 * Farms apply the variant recipe to designated groups, report outcomes.
 * Central then analyzes results and publishes findings network-wide.
 *
 * Data flow:
 *   Central creates experiment → pushes to farms → farms apply variant →
 *   farms report outcomes → Central analyzes → publishes findings
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

/**
 * Ensure the experiments table exists.
 */
export async function initExperimentTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ab_experiments (
      id SERIAL PRIMARY KEY,
      experiment_id TEXT UNIQUE NOT NULL,
      crop TEXT NOT NULL,
      hypothesis TEXT,
      status TEXT DEFAULT 'draft',
      control_params JSONB DEFAULT '{}',
      variant_params JSONB DEFAULT '{}',
      assigned_farms JSONB DEFAULT '[]',
      results JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      findings TEXT
    );

    CREATE TABLE IF NOT EXISTS ab_experiment_observations (
      id SERIAL PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      farm_id TEXT NOT NULL,
      group_id TEXT,
      arm TEXT NOT NULL,
      outcomes JSONB DEFAULT '{}',
      recorded_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

/**
 * Create a new A/B experiment.
 *
 * @param {object} params
 * @param {string} params.crop — target crop
 * @param {string} params.hypothesis — what we're testing
 * @param {object} params.control — control recipe params (baseline)
 * @param {object} params.variant — variant recipe params (the change)
 * @param {string[]} params.farm_ids — farms to assign
 * @returns {object} created experiment
 */
export async function createExperiment({ crop, hypothesis, control, variant, farm_ids = [] }) {
  const experimentId = `exp-${crop}-${Date.now().toString(36)}`;

  const result = await pool.query(`
    INSERT INTO ab_experiments (experiment_id, crop, hypothesis, control_params, variant_params, assigned_farms, status)
    VALUES ($1, $2, $3, $4, $5, $6, 'draft')
    RETURNING *
  `, [experimentId, crop, hypothesis, JSON.stringify(control || {}), JSON.stringify(variant || {}), JSON.stringify(farm_ids)]);

  return result.rows[0];
}

/**
 * Activate an experiment — mark as running and set start time.
 */
export async function activateExperiment(experimentId) {
  const result = await pool.query(`
    UPDATE ab_experiments
    SET status = 'running', started_at = NOW()
    WHERE experiment_id = $1 AND status = 'draft'
    RETURNING *
  `, [experimentId]);

  return result.rows[0] || null;
}

/**
 * Record an observation from a farm.
 *
 * @param {string} experimentId
 * @param {string} farmId
 * @param {string} arm — 'control' or 'variant'
 * @param {object} outcomes — { weight_per_plant_oz, quality_score, grow_days, loss_rate }
 * @param {string} [groupId]
 */
export async function recordObservation(experimentId, farmId, arm, outcomes, groupId = null) {
  await pool.query(`
    INSERT INTO ab_experiment_observations (experiment_id, farm_id, group_id, arm, outcomes)
    VALUES ($1, $2, $3, $4, $5)
  `, [experimentId, farmId, groupId, arm, JSON.stringify(outcomes)]);
}

/**
 * Analyze experiment results.
 * Compares control vs variant outcomes across all observations.
 *
 * @param {string} experimentId
 * @returns {object} analysis
 */
export async function analyzeExperiment(experimentId) {
  const obsResult = await pool.query(`
    SELECT arm, outcomes FROM ab_experiment_observations
    WHERE experiment_id = $1
    ORDER BY arm, recorded_at
  `, [experimentId]);

  const groups = { control: [], variant: [] };
  for (const row of obsResult.rows) {
    if (groups[row.arm]) groups[row.arm].push(row.outcomes);
  }

  const summarize = (arr) => {
    if (arr.length === 0) return null;
    const weights = arr.map(o => parseFloat(o.weight_per_plant_oz || 0)).filter(w => w > 0);
    const quality = arr.map(o => parseFloat(o.quality_score || 0)).filter(q => q > 0);
    return {
      n: arr.length,
      avg_weight: weights.length > 0 ? +(weights.reduce((a, b) => a + b, 0) / weights.length).toFixed(2) : null,
      avg_quality: quality.length > 0 ? +(quality.reduce((a, b) => a + b, 0) / quality.length).toFixed(2) : null,
      weights,
      quality
    };
  };

  const controlSummary = summarize(groups.control);
  const variantSummary = summarize(groups.variant);

  let verdict = 'insufficient_data';
  let weightDelta = null;
  let qualityDelta = null;

  if (controlSummary && variantSummary && controlSummary.n >= 3 && variantSummary.n >= 3) {
    weightDelta = controlSummary.avg_weight && variantSummary.avg_weight
      ? +((variantSummary.avg_weight - controlSummary.avg_weight) / controlSummary.avg_weight * 100).toFixed(1)
      : null;
    qualityDelta = controlSummary.avg_quality && variantSummary.avg_quality
      ? +((variantSummary.avg_quality - controlSummary.avg_quality) / controlSummary.avg_quality * 100).toFixed(1)
      : null;

    if (weightDelta !== null && weightDelta > 5) verdict = 'variant_wins';
    else if (weightDelta !== null && weightDelta < -5) verdict = 'control_wins';
    else verdict = 'no_significant_difference';
  }

  const analysis = {
    experiment_id: experimentId,
    control: controlSummary,
    variant: variantSummary,
    weight_delta_pct: weightDelta,
    quality_delta_pct: qualityDelta,
    verdict,
    analyzed_at: new Date().toISOString()
  };

  // Persist results
  await pool.query(`
    UPDATE ab_experiments
    SET results = $1, status = CASE WHEN status = 'running' THEN 'analyzed' ELSE status END
    WHERE experiment_id = $2
  `, [JSON.stringify(analysis), experimentId]);

  return analysis;
}

/**
 * Complete an experiment and record findings.
 */
export async function completeExperiment(experimentId, findings) {
  const result = await pool.query(`
    UPDATE ab_experiments
    SET status = 'completed', completed_at = NOW(), findings = $1
    WHERE experiment_id = $2
    RETURNING *
  `, [findings, experimentId]);

  return result.rows[0] || null;
}

/**
 * List experiments with optional status filter.
 */
export async function listExperiments(status = null) {
  const query = status
    ? 'SELECT * FROM ab_experiments WHERE status = $1 ORDER BY created_at DESC'
    : 'SELECT * FROM ab_experiments ORDER BY created_at DESC';
  const params = status ? [status] : [];
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get experiment details with observation counts.
 */
export async function getExperiment(experimentId) {
  const expResult = await pool.query('SELECT * FROM ab_experiments WHERE experiment_id = $1', [experimentId]);
  if (expResult.rows.length === 0) return null;

  const obsResult = await pool.query(`
    SELECT arm, COUNT(*) AS count
    FROM ab_experiment_observations
    WHERE experiment_id = $1
    GROUP BY arm
  `, [experimentId]);

  const experiment = expResult.rows[0];
  experiment.observation_counts = {};
  for (const row of obsResult.rows) {
    experiment.observation_counts[row.arm] = parseInt(row.count);
  }

  return experiment;
}

/**
 * Build experiment assignment payload for a specific farm.
 * Returns active experiments this farm should be running.
 */
export async function getExperimentsForFarm(farmId) {
  const result = await pool.query(`
    SELECT experiment_id, crop, hypothesis, control_params, variant_params
    FROM ab_experiments
    WHERE status = 'running'
      AND assigned_farms::jsonb ? $1
    ORDER BY started_at DESC
  `, [farmId]);

  return result.rows.map(r => ({
    experiment_id: r.experiment_id,
    crop: r.crop,
    hypothesis: r.hypothesis,
    control: r.control_params,
    variant: r.variant_params
  }));
}

export default {
  initExperimentTables,
  createExperiment,
  activateExperiment,
  recordObservation,
  analyzeExperiment,
  completeExperiment,
  listExperiments,
  getExperiment,
  getExperimentsForFarm
};
