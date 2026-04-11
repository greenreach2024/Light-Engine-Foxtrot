import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/farm/salad-mixes
 * List active mix templates with components and trait metadata.
 * Farm-accessible (no admin auth required).
 */
router.get('/', async (req, res) => {
    try {
        const farmId = req.headers['x-farm-id'] || null;

        const { rows: templates } = await query(
            `SELECT id, name, description, status, created_at
             FROM mix_templates WHERE status = 'active' ORDER BY name ASC`
        );

        const templateIds = templates.map(t => t.id);
        let componentsMap = {};
        let overridesMap = {};

        if (templateIds.length > 0) {
            // Fetch components with trait data
            const { rows: components } = await query(
                `SELECT id, mix_template_id, product_name, product_id, ratio,
                        trait_role, color_profile, taste_profile, texture_profile
                 FROM mix_components WHERE mix_template_id = ANY($1)
                 ORDER BY mix_template_id, ratio DESC`,
                [templateIds]
            );
            for (const c of components) {
                if (!componentsMap[c.mix_template_id]) componentsMap[c.mix_template_id] = [];
                componentsMap[c.mix_template_id].push(c);
            }

            // Fetch farm-specific overrides if farm_id provided
            if (farmId) {
                const { rows: overrides } = await query(
                    `SELECT component_id, substitute_crop FROM farm_mix_overrides
                     WHERE farm_id = $1 AND mix_template_id = ANY($2)`,
                    [farmId, templateIds]
                );
                for (const o of overrides) {
                    overridesMap[o.component_id] = o.substitute_crop;
                }
            }
        }

        const result = templates.map(t => ({
            ...t,
            components: (componentsMap[t.id] || []).map(c => ({
                ...c,
                farm_substitute: overridesMap[c.id] || null
            }))
        }));

        res.json({ success: true, mixes: result });
    } catch (err) {
        console.error('[Farm Salad Mixes] GET /:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load mix templates' });
    }
});

/**
 * GET /api/farm/salad-mixes/:id/alternatives
 * Get alternative crops for each slot in a mix template based on trait matching.
 */
router.get('/:id/alternatives', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid mix ID' });

        // Get components with traits
        const { rows: components } = await query(
            `SELECT id, product_name, ratio, trait_role, color_profile, taste_profile, texture_profile
             FROM mix_components WHERE mix_template_id = $1 ORDER BY ratio DESC`,
            [id]
        );

        if (components.length === 0) {
            return res.status(404).json({ success: false, error: 'Mix template not found or has no components' });
        }

        // For each component, find alternative crops matching by trait
        const alternatives = {};
        for (const comp of components) {
            // Match by: same color OR same taste OR same texture (at least 2 of 3 must match)
            // If traits not set, fall back to all salad-eligible crops
            if (comp.color_profile || comp.taste_profile || comp.texture_profile) {
                const { rows: alts } = await query(
                    `SELECT crop_name, color_profile, taste_profile, texture_profile
                     FROM crop_traits
                     WHERE salad_eligible = TRUE
                       AND crop_name != $1
                       AND (
                         (color_profile = $2 AND taste_profile = $3)
                         OR (color_profile = $2 AND texture_profile = $4)
                         OR (taste_profile = $3 AND texture_profile = $4)
                       )
                     ORDER BY
                       CASE WHEN color_profile = $2 AND taste_profile = $3 AND texture_profile = $4 THEN 0
                            WHEN color_profile = $2 AND taste_profile = $3 THEN 1
                            WHEN color_profile = $2 AND texture_profile = $4 THEN 2
                            ELSE 3 END,
                       crop_name ASC`,
                    [comp.product_name, comp.color_profile || 'green', comp.taste_profile || 'mild', comp.texture_profile || 'tender']
                );
                alternatives[comp.id] = alts;
            } else {
                // No traits set -- return all salad-eligible crops except the current one
                const { rows: alts } = await query(
                    `SELECT crop_name, color_profile, taste_profile, texture_profile
                     FROM crop_traits WHERE salad_eligible = TRUE AND crop_name != $1
                     ORDER BY crop_name ASC`,
                    [comp.product_name]
                );
                alternatives[comp.id] = alts;
            }
        }

        res.json({ success: true, components, alternatives });
    } catch (err) {
        console.error('[Farm Salad Mixes] GET /:id/alternatives:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load alternatives' });
    }
});

/**
 * PUT /api/farm/salad-mixes/overrides
 * Save farm-specific crop substitutions for a mix template.
 * Body: { mix_template_id, overrides: [{ component_id, substitute_crop }] }
 */
router.put('/overrides', async (req, res) => {
    try {
        const farmId = req.headers['x-farm-id'];
        if (!farmId) return res.status(400).json({ success: false, error: 'x-farm-id header required' });

        const { mix_template_id, overrides } = req.body;
        if (!mix_template_id || !Array.isArray(overrides)) {
            return res.status(400).json({ success: false, error: 'mix_template_id and overrides[] required' });
        }

        // Validate mix_template_id exists
        const { rows: [tmpl] } = await query('SELECT id FROM mix_templates WHERE id = $1', [mix_template_id]);
        if (!tmpl) return res.status(404).json({ success: false, error: 'Mix template not found' });

        // Upsert each override
        const saved = [];
        for (const o of overrides) {
            if (!o.component_id || !o.substitute_crop) continue;
            const componentId = parseInt(o.component_id, 10);
            const substituteCrop = String(o.substitute_crop).trim();
            if (isNaN(componentId) || !substituteCrop) continue;

            // Validate component belongs to this template
            const { rows: [comp] } = await query(
                'SELECT id FROM mix_components WHERE id = $1 AND mix_template_id = $2',
                [componentId, mix_template_id]
            );
            if (!comp) continue;

            const { rows: [row] } = await query(
                `INSERT INTO farm_mix_overrides (farm_id, mix_template_id, component_id, substitute_crop)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (farm_id, component_id) DO UPDATE SET substitute_crop = $4, updated_at = NOW()
                 RETURNING id, component_id, substitute_crop`,
                [farmId, mix_template_id, componentId, substituteCrop]
            );
            saved.push(row);
        }

        res.json({ success: true, overrides: saved });
    } catch (err) {
        console.error('[Farm Salad Mixes] PUT /overrides:', err.message);
        res.status(500).json({ success: false, error: 'Failed to save overrides' });
    }
});

/**
 * DELETE /api/farm/salad-mixes/overrides/:componentId
 * Remove a farm-specific crop substitution (revert to default).
 */
router.delete('/overrides/:componentId', async (req, res) => {
    try {
        const farmId = req.headers['x-farm-id'];
        if (!farmId) return res.status(400).json({ success: false, error: 'x-farm-id header required' });

        const componentId = parseInt(req.params.componentId, 10);
        if (isNaN(componentId)) return res.status(400).json({ success: false, error: 'Invalid component ID' });

        await query(
            'DELETE FROM farm_mix_overrides WHERE farm_id = $1 AND component_id = $2',
            [farmId, componentId]
        );

        res.json({ success: true, message: 'Override removed' });
    } catch (err) {
        console.error('[Farm Salad Mixes] DELETE /overrides/:id:', err.message);
        res.status(500).json({ success: false, error: 'Failed to remove override' });
    }
});

/**
 * GET /api/farm/salad-mixes/crop-traits
 * Get all salad-eligible crop traits for reference.
 */
router.get('/crop-traits', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT crop_name, color_profile, taste_profile, texture_profile
             FROM crop_traits WHERE salad_eligible = TRUE ORDER BY crop_name ASC`
        );
        res.json({ success: true, traits: rows });
    } catch (err) {
        console.error('[Farm Salad Mixes] GET /crop-traits:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load crop traits' });
    }
});

export default router;
