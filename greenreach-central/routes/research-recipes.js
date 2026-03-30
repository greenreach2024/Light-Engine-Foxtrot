import { Router } from 'express';
import { query, isDatabaseAvailable } from '../config/database.js';
import { verifyStudyOwnership } from '../middleware/research-tenant.js';

const router = Router();

const checkDb = async (req, res, next) => {
  if (!(await isDatabaseAvailable())) {
    return res.status(503).json({ ok: false, error: 'Database not available' });
  }
  next();
};

router.use(checkDb);

// ── Beta Recipe Lifecycle Management ──
// recipe_versions: id, farm_id, study_id, recipe_name, version_number, status (draft|review|approved_beta|live|archived|retired),
//   parameters (JSONB), created_by, created_at, updated_at, promoted_from, release_notes, rationale
// recipe_deployments: id, recipe_version_id, farm_id, room_id, zone_id, deployed_at, deployed_by,
//   operator_acknowledged, acknowledged_at, rollback_reason, rolled_back_at, status (active|rolled_back|completed)
// recipe_comparisons: id, study_id, control_recipe_id, beta_recipe_id, farm_id, metric_name, control_value,
//   beta_value, delta, unit, measured_at, created_at
// recipe_eligibility_rules: id, recipe_version_id, rule_type (farm|room|crop_group|batch), rule_value (JSONB), created_at
// recipe_operator_acks: id, deployment_id, operator_user_id, acknowledged_at, notes

// ── List recipe versions ──
router.get('/research/recipes', async (req, res) => {
  try {
    const farmId = req.farmId || req.query.farm_id;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { status, study_id, limit = 20, offset = 0 } = req.query;
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
    const params = [farmId];
    let where = 'WHERE rv.farm_id = $1';
    if (status) {
      params.push(status);
      where += ` AND rv.status = $${params.length}`;
    }
    if (study_id) {
      params.push(study_id);
      where += ` AND rv.study_id = $${params.length}`;
    }
    params.push(safeLimit, safeOffset);

    const result = await query(`
      SELECT rv.*,
        s.title as study_title,
        (SELECT COUNT(*) FROM recipe_deployments rd WHERE rd.recipe_version_id = rv.id) as deployment_count,
        (SELECT COUNT(*) FROM recipe_comparisons rc WHERE rc.beta_recipe_id = rv.id) as comparison_count
      FROM recipe_versions rv
      LEFT JOIN studies s ON rv.study_id = s.id
      ${where}
      ORDER BY rv.updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({ ok: true, recipes: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchRecipes] List error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list recipe versions' });
  }
});

// ── Create recipe version ──
router.post('/research/recipes', async (req, res) => {
  try {
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const { study_id, recipe_name, parameters, release_notes, rationale, promoted_from } = req.body;
    if (!recipe_name) return res.status(400).json({ ok: false, error: 'recipe_name required' });

    // Auto-increment version number for this recipe name within the farm
    const versionResult = await query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version
       FROM recipe_versions WHERE farm_id = $1 AND recipe_name = $2`,
      [farmId, recipe_name]
    );
    const nextVersion = versionResult.rows[0].next_version;

    const result = await query(`
      INSERT INTO recipe_versions (farm_id, study_id, recipe_name, version_number, status, parameters, created_by, release_notes, rationale, promoted_from)
      VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9)
      RETURNING *
    `, [farmId, study_id || null, recipe_name, nextVersion, JSON.stringify(parameters || {}), req.userId || null, release_notes || null, rationale || null, promoted_from || null]);

    res.status(201).json({ ok: true, recipe: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Create error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create recipe version' });
  }
});

// ── Get single recipe version ──
router.get('/research/recipes/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT rv.*,
        s.title as study_title,
        json_agg(DISTINCT jsonb_build_object('id', rd.id, 'room_id', rd.room_id, 'zone_id', rd.zone_id, 'status', rd.status, 'deployed_at', rd.deployed_at, 'operator_acknowledged', rd.operator_acknowledged)) FILTER (WHERE rd.id IS NOT NULL) as deployments,
        json_agg(DISTINCT jsonb_build_object('id', re.id, 'rule_type', re.rule_type, 'rule_value', re.rule_value)) FILTER (WHERE re.id IS NOT NULL) as eligibility_rules
      FROM recipe_versions rv
      LEFT JOIN studies s ON rv.study_id = s.id
      LEFT JOIN recipe_deployments rd ON rd.recipe_version_id = rv.id
      LEFT JOIN recipe_eligibility_rules re ON re.recipe_version_id = rv.id
      WHERE rv.id = $1
      GROUP BY rv.id, s.title
    `, [req.params.id]);

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Recipe version not found' });
    res.json({ ok: true, recipe: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Get error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get recipe version' });
  }
});

// ── Transition recipe status (draft -> review -> approved_beta -> live -> archived) ──
router.patch('/research/recipes/:id/status', async (req, res) => {
  try {
    const { status, rationale } = req.body;
    const validTransitions = {
      draft: ['review', 'archived'],
      review: ['approved_beta', 'draft', 'archived'],
      approved_beta: ['live', 'review', 'archived'],
      live: ['archived', 'retired'],
      archived: ['draft'],
      retired: []
    };

    const current = await query('SELECT status, farm_id FROM recipe_versions WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'Recipe version not found' });

    const currentStatus = current.rows[0].status;
    if (!validTransitions[currentStatus]?.includes(status)) {
      return res.status(400).json({ ok: false, error: `Cannot transition from ${currentStatus} to ${status}` });
    }

    const result = await query(`
      UPDATE recipe_versions SET status = $1, rationale = COALESCE($2, rationale), updated_at = NOW()
      WHERE id = $3 RETURNING *
    `, [status, rationale || null, req.params.id]);

    res.json({ ok: true, recipe: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Status transition error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update recipe status' });
  }
});

// ── Update recipe parameters ──
router.patch('/research/recipes/:id', async (req, res) => {
  try {
    const { parameters, release_notes, rationale } = req.body;
    const current = await query('SELECT status FROM recipe_versions WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ ok: false, error: 'Recipe version not found' });
    if (current.rows[0].status !== 'draft') {
      return res.status(400).json({ ok: false, error: 'Only draft recipes can be edited' });
    }

    const fields = [];
    const params = [];
    let idx = 1;
    if (parameters !== undefined) { fields.push(`parameters = $${idx}`); params.push(JSON.stringify(parameters)); idx++; }
    if (release_notes !== undefined) { fields.push(`release_notes = $${idx}`); params.push(release_notes); idx++; }
    if (rationale !== undefined) { fields.push(`rationale = $${idx}`); params.push(rationale); idx++; }
    if (!fields.length) return res.status(400).json({ ok: false, error: 'No fields to update' });

    fields.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const result = await query(`UPDATE recipe_versions SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, params);
    res.json({ ok: true, recipe: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Update error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to update recipe version' });
  }
});

router.delete('/research/recipes/:id', async (req, res) => {
  try {
    const farmId = req.farmId;
    const result = await query('DELETE FROM recipe_versions WHERE id = $1 AND farm_id = $2 RETURNING id', [req.params.id, farmId]);
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Recipe not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[ResearchRecipes] Delete error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to delete recipe' });
  }
});

// ── Deploy recipe to farm/room/zone ──
router.post('/research/recipes/:id/deploy', async (req, res) => {
  try {
    const { room_id, zone_id } = req.body;
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });

    const recipe = await query('SELECT status FROM recipe_versions WHERE id = $1', [req.params.id]);
    if (!recipe.rows.length) return res.status(404).json({ ok: false, error: 'Recipe version not found' });
    if (!['approved_beta', 'live'].includes(recipe.rows[0].status)) {
      return res.status(400).json({ ok: false, error: 'Only approved_beta or live recipes can be deployed' });
    }

    // Check eligibility rules
    const rules = await query('SELECT rule_type, rule_value FROM recipe_eligibility_rules WHERE recipe_version_id = $1', [req.params.id]);
    for (const rule of rules.rows) {
      if (rule.rule_type === 'farm' && !rule.rule_value?.farm_ids?.includes(farmId)) {
        return res.status(403).json({ ok: false, error: 'Farm not eligible for this recipe' });
      }
      if (rule.rule_type === 'room' && room_id && !rule.rule_value?.room_ids?.includes(room_id)) {
        return res.status(403).json({ ok: false, error: 'Room not eligible for this recipe' });
      }
    }

    const result = await query(`
      INSERT INTO recipe_deployments (recipe_version_id, farm_id, room_id, zone_id, deployed_by, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
    `, [req.params.id, farmId, room_id || null, zone_id || null, req.userId || null]);

    res.status(201).json({ ok: true, deployment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Deploy error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to deploy recipe' });
  }
});

// ── Operator acknowledge deployment ──
router.post('/research/deployments/:id/acknowledge', async (req, res) => {
  try {
    const { notes } = req.body;
    const deployment = await query('SELECT id FROM recipe_deployments WHERE id = $1', [req.params.id]);
    if (!deployment.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found' });

    await query(`
      INSERT INTO recipe_operator_acks (deployment_id, operator_user_id, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (deployment_id, operator_user_id) DO UPDATE SET acknowledged_at = NOW(), notes = $3
    `, [req.params.id, req.userId || null, notes || null]);

    await query('UPDATE recipe_deployments SET operator_acknowledged = true, acknowledged_at = NOW() WHERE id = $1', [req.params.id]);

    res.json({ ok: true, message: 'Deployment acknowledged' });
  } catch (err) {
    console.error('[ResearchRecipes] Acknowledge error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to acknowledge deployment' });
  }
});

// ── Rollback deployment ──
router.post('/research/deployments/:id/rollback', async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ ok: false, error: 'Rollback reason required' });

    const result = await query(`
      UPDATE recipe_deployments SET status = 'rolled_back', rollback_reason = $1, rolled_back_at = NOW()
      WHERE id = $2 AND status = 'active'
      RETURNING *
    `, [reason, req.params.id]);

    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Active deployment not found' });
    res.json({ ok: true, deployment: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Rollback error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to rollback deployment' });
  }
});

// ── Record recipe comparison data ──
router.post('/research/recipes/:id/compare', async (req, res) => {
  try {
    const { control_recipe_id, metric_name, control_value, beta_value, unit, study_id } = req.body;
    const farmId = req.farmId;
    if (!farmId) return res.status(400).json({ ok: false, error: 'farm_id required' });
    if (!metric_name || control_value === undefined || beta_value === undefined) {
      return res.status(400).json({ ok: false, error: 'metric_name, control_value, and beta_value required' });
    }

    const delta = parseFloat(beta_value) - parseFloat(control_value);

    const result = await query(`
      INSERT INTO recipe_comparisons (study_id, control_recipe_id, beta_recipe_id, farm_id, metric_name, control_value, beta_value, delta, unit)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [study_id || null, control_recipe_id || null, req.params.id, farmId, metric_name, control_value, beta_value, delta, unit || null]);

    res.status(201).json({ ok: true, comparison: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Compare error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to record comparison' });
  }
});

// ── Get comparison dashboard data ──
router.get('/research/recipes/:id/comparisons', async (req, res) => {
  try {
    const result = await query(`
      SELECT rc.*,
        rv_ctrl.recipe_name as control_recipe_name, rv_ctrl.version_number as control_version,
        rv_beta.recipe_name as beta_recipe_name, rv_beta.version_number as beta_version
      FROM recipe_comparisons rc
      LEFT JOIN recipe_versions rv_ctrl ON rc.control_recipe_id = rv_ctrl.id
      LEFT JOIN recipe_versions rv_beta ON rc.beta_recipe_id = rv_beta.id
      WHERE rc.beta_recipe_id = $1
      ORDER BY rc.measured_at DESC
      LIMIT 200
    `, [req.params.id]);

    res.json({ ok: true, comparisons: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchRecipes] Comparisons error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to get comparisons' });
  }
});

// ── Set eligibility rules ──
router.post('/research/recipes/:id/eligibility', async (req, res) => {
  try {
    const { rule_type, rule_value } = req.body;
    if (!rule_type || !rule_value) return res.status(400).json({ ok: false, error: 'rule_type and rule_value required' });
    if (!['farm', 'room', 'crop_group', 'batch'].includes(rule_type)) {
      return res.status(400).json({ ok: false, error: 'Invalid rule_type' });
    }

    const result = await query(`
      INSERT INTO recipe_eligibility_rules (recipe_version_id, rule_type, rule_value)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [req.params.id, rule_type, JSON.stringify(rule_value)]);

    res.status(201).json({ ok: true, rule: result.rows[0] });
  } catch (err) {
    console.error('[ResearchRecipes] Eligibility error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create eligibility rule' });
  }
});

// ── List deployments for a recipe ──
router.get('/research/recipes/:id/deployments', async (req, res) => {
  try {
    const result = await query(`
      SELECT rd.*,
        json_agg(jsonb_build_object('operator_user_id', ra.operator_user_id, 'acknowledged_at', ra.acknowledged_at, 'notes', ra.notes)) FILTER (WHERE ra.id IS NOT NULL) as operator_acks
      FROM recipe_deployments rd
      LEFT JOIN recipe_operator_acks ra ON ra.deployment_id = rd.id
      WHERE rd.recipe_version_id = $1
      GROUP BY rd.id
      ORDER BY rd.deployed_at DESC
    `, [req.params.id]);

    res.json({ ok: true, deployments: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[ResearchRecipes] Deployments error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to list deployments' });
  }
});

export default router;
