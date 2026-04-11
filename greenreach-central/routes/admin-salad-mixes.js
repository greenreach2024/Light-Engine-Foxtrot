import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/admin/salad-mixes
 * List all mix templates with their components
 */
router.get('/', async (req, res) => {
    try {
        const { rows: templates } = await query(
            `SELECT id, name, description, status, created_by, created_at, updated_at
             FROM mix_templates ORDER BY name ASC`
        );
        // Fetch components for all templates in one query
        const templateIds = templates.map(t => t.id);
        let componentsMap = {};
        if (templateIds.length > 0) {
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
        }
        const result = templates.map(t => ({
            ...t,
            components: componentsMap[t.id] || []
        }));
        res.json({ success: true, mixes: result });
    } catch (err) {
        console.error('[Salad Mixes] GET /:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load mix templates' });
    }
});

/**
 * GET /api/admin/salad-mixes/:id
 * Get a single mix template with components
 */
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid mix ID' });

        const { rows: [template] } = await query(
            `SELECT id, name, description, status, created_by, created_at, updated_at
             FROM mix_templates WHERE id = $1`, [id]
        );
        if (!template) return res.status(404).json({ success: false, error: 'Mix template not found' });

        const { rows: components } = await query(
            `SELECT id, product_name, product_id, ratio,
                    trait_role, color_profile, taste_profile, texture_profile
             FROM mix_components
             WHERE mix_template_id = $1 ORDER BY ratio DESC`, [id]
        );
        res.json({ success: true, mix: { ...template, components } });
    } catch (err) {
        console.error('[Salad Mixes] GET /:id:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load mix template' });
    }
});

/**
 * POST /api/admin/salad-mixes
 * Create a new mix template with components
 * Body: { name, description, components: [{ product_name, product_id, ratio }] }
 */
router.post('/', async (req, res) => {
    try {
        const { name, description, components } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Mix name is required' });
        }
        if (!Array.isArray(components) || components.length < 2 || components.length > 4) {
            return res.status(400).json({ success: false, error: 'A mix must have 2-4 components' });
        }
        // Validate ratios sum to 1.0
        const ratioSum = components.reduce((sum, c) => sum + parseFloat(c.ratio || 0), 0);
        if (Math.abs(ratioSum - 1.0) > 0.01) {
            return res.status(400).json({ success: false, error: `Component ratios must sum to 100%. Current sum: ${(ratioSum * 100).toFixed(1)}%` });
        }
        for (const c of components) {
            if (!c.product_name || !c.product_name.trim()) {
                return res.status(400).json({ success: false, error: 'Each component must have a product name' });
            }
            if (!c.ratio || parseFloat(c.ratio) <= 0) {
                return res.status(400).json({ success: false, error: 'Each component must have a positive ratio' });
            }
        }

        const adminEmail = req.admin?.email || 'unknown';
        const { rows: [template] } = await query(
            `INSERT INTO mix_templates (name, description, status, created_by)
             VALUES ($1, $2, 'active', $3) RETURNING id, name, description, status, created_by, created_at`,
            [name.trim(), description?.trim() || null, adminEmail]
        );

        // Insert components
        const insertedComponents = [];
        for (const c of components) {
            const { rows: [comp] } = await query(
                `INSERT INTO mix_components (mix_template_id, product_name, product_id, ratio, trait_role, color_profile, taste_profile, texture_profile)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id, product_name, product_id, ratio, trait_role, color_profile, taste_profile, texture_profile`,
                [template.id, c.product_name.trim(), c.product_id || null, parseFloat(c.ratio),
                 c.trait_role?.trim() || null, c.color_profile || null, c.taste_profile || null, c.texture_profile || null]
            );
            insertedComponents.push(comp);
        }

        res.json({ success: true, mix: { ...template, components: insertedComponents } });
    } catch (err) {
        console.error('[Salad Mixes] POST /:', err.message);
        res.status(500).json({ success: false, error: 'Failed to create mix template' });
    }
});

/**
 * PUT /api/admin/salad-mixes/:id
 * Update a mix template and its components (replace all components)
 * Body: { name, description, status, components: [{ product_name, product_id, ratio }] }
 */
router.put('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid mix ID' });

        const { name, description, status, components } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, error: 'Mix name is required' });
        }
        if (!Array.isArray(components) || components.length < 2 || components.length > 4) {
            return res.status(400).json({ success: false, error: 'A mix must have 2-4 components' });
        }
        const ratioSum = components.reduce((sum, c) => sum + parseFloat(c.ratio || 0), 0);
        if (Math.abs(ratioSum - 1.0) > 0.01) {
            return res.status(400).json({ success: false, error: `Component ratios must sum to 100%. Current sum: ${(ratioSum * 100).toFixed(1)}%` });
        }
        for (const c of components) {
            if (!c.product_name || !c.product_name.trim()) {
                return res.status(400).json({ success: false, error: 'Each component must have a product name' });
            }
            if (!c.ratio || parseFloat(c.ratio) <= 0) {
                return res.status(400).json({ success: false, error: 'Each component must have a positive ratio' });
            }
        }

        // Update template
        const { rows: [template] } = await query(
            `UPDATE mix_templates SET name = $1, description = $2, status = $3, updated_at = NOW()
             WHERE id = $4 RETURNING id, name, description, status, created_by, created_at, updated_at`,
            [name.trim(), description?.trim() || null, status || 'active', id]
        );
        if (!template) return res.status(404).json({ success: false, error: 'Mix template not found' });

        // Replace components: delete old, insert new
        await query(`DELETE FROM mix_components WHERE mix_template_id = $1`, [id]);
        const insertedComponents = [];
        for (const c of components) {
            const { rows: [comp] } = await query(
                `INSERT INTO mix_components (mix_template_id, product_name, product_id, ratio, trait_role, color_profile, taste_profile, texture_profile)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING id, product_name, product_id, ratio, trait_role, color_profile, taste_profile, texture_profile`,
                [id, c.product_name.trim(), c.product_id || null, parseFloat(c.ratio),
                 c.trait_role?.trim() || null, c.color_profile || null, c.taste_profile || null, c.texture_profile || null]
            );
            insertedComponents.push(comp);
        }

        res.json({ success: true, mix: { ...template, components: insertedComponents } });
    } catch (err) {
        console.error('[Salad Mixes] PUT /:id:', err.message);
        res.status(500).json({ success: false, error: 'Failed to update mix template' });
    }
});

/**
 * DELETE /api/admin/salad-mixes/:id
 * Delete a mix template (cascade deletes components)
 */
router.delete('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid mix ID' });

        const { rowCount } = await query(`DELETE FROM mix_templates WHERE id = $1`, [id]);
        if (rowCount === 0) return res.status(404).json({ success: false, error: 'Mix template not found' });

        res.json({ success: true, message: 'Mix template deleted' });
    } catch (err) {
        console.error('[Salad Mixes] DELETE /:id:', err.message);
        res.status(500).json({ success: false, error: 'Failed to delete mix template' });
    }
});

export default router;
