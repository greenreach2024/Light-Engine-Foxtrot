/**
 * Quality Control System - QA Checkpoints with Photo Documentation
 * Formal quality workflows at key production stages
 */

import express from 'express';
import { db } from '../server/utils/db-pool.js';

const router = express.Router();

// QA Standards Database
const QA_STANDARDS = {
    seeding: {
        criteria: [
            'Seeds placed correctly in medium',
            'Proper spacing maintained',
            'Medium moisture level adequate',
            'No contamination visible',
            'Tray labels applied correctly'
        ],
        pass_threshold: 'All criteria met'
    },
    germination: {
        criteria: [
            'Germination rate above 85%',
            'Seedlings uniform in size',
            'No mold or fungus present',
            'Root development visible',
            'Cotyledons fully opened'
        ],
        pass_threshold: 'Minimum 85% germination'
    },
    transplant: {
        criteria: [
            'Plants transferred without damage',
            'Roots properly positioned',
            'Proper depth in growing medium',
            'No wilting observed',
            'Spacing meets specifications'
        ],
        pass_threshold: 'Less than 5% damage'
    },
    growth_midpoint: {
        criteria: [
            'Growth rate on target',
            'Color and vigor good',
            'No pest damage visible',
            'No nutrient deficiency signs',
            'Proper size for stage'
        ],
        pass_threshold: 'No major issues'
    },
    pre_harvest: {
        criteria: [
            'Size meets harvest specifications',
            'Color appropriate for variety',
            'No pest damage or disease',
            'Firmness and texture correct',
            'Ready for harvest timing'
        ],
        pass_threshold: 'Meets all harvest criteria'
    },
    post_harvest: {
        criteria: [
            'Harvest completed without damage',
            'Proper handling maintained',
            'Temperature controlled',
            'No wilting or bruising',
            'Trimming and cleaning adequate'
        ],
        pass_threshold: 'Less than 2% waste'
    },
    packing: {
        criteria: [
            'Proper packaging materials used',
            'Weight meets specifications',
            'Labeling correct and legible',
            'No damaged product included',
            'Temperature maintained'
        ],
        pass_threshold: 'All packing standards met'
    },
    pre_shipment: {
        criteria: [
            'Final visual inspection passed',
            'Temperature logs verified',
            'Documentation complete',
            'Packaging integrity intact',
            'Ready for customer delivery'
        ],
        pass_threshold: 'Ready to ship'
    }
};

/**
 * POST /api/quality/checkpoints/record
 * Create a new quality checkpoint record
 */
router.post('/checkpoints/record', async (req, res) => {
    try {
        const {
            batch_id,
            checkpoint_type,
            inspector,
            result,
            notes,
            photo_data,
            metrics,
            corrective_action,
            farm_id
        } = req.body;

        // Validate required fields
        if (!batch_id || !checkpoint_type || !inspector || !result) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: batch_id, checkpoint_type, inspector, result'
            });
        }

        // Validate checkpoint type
        const validTypes = Object.keys(QA_STANDARDS);
        if (!validTypes.includes(checkpoint_type)) {
            return res.status(400).json({
                success: false,
                error: `Invalid checkpoint_type. Must be one of: ${validTypes.join(', ')}`
            });
        }

        // Validate result
        const validResults = ['pass', 'pass_with_notes', 'fail', 'pending'];
        if (!validResults.includes(result)) {
            return res.status(400).json({
                success: false,
                error: `Invalid result. Must be one of: ${validResults.join(', ')}`
            });
        }

        // Insert checkpoint
        const insertQuery = `
            INSERT INTO qa_checkpoints (
                batch_id, checkpoint_type, inspector, result,
                notes, photo_data, metrics, corrective_action,
                farm_id, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING *
        `;

        const values = [
            batch_id,
            checkpoint_type,
            inspector,
            result,
            notes || null,
            photo_data || null,
            metrics ? JSON.stringify(metrics) : null,
            corrective_action || null,
            farm_id || null
        ];

        const checkpointResult = await db.query(insertQuery, values);
        const checkpoint = checkpointResult.rows[0];

        // Parse JSON fields
        if (checkpoint.metrics) {
            checkpoint.metrics = JSON.parse(checkpoint.metrics);
        }

        res.json({
            success: true,
            data: {
                checkpoint_id: checkpoint.id,
                batch_id: checkpoint.batch_id,
                checkpoint_type: checkpoint.checkpoint_type,
                inspector: checkpoint.inspector,
                result: checkpoint.result,
                notes: checkpoint.notes,
                has_photo: !!checkpoint.photo_data,
                metrics: checkpoint.metrics,
                corrective_action: checkpoint.corrective_action,
                timestamp: checkpoint.created_at
            }
        });

    } catch (error) {
        console.error('[QC] Error recording checkpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to record checkpoint',
            message: error.message
        });
    }
});

/**
 * GET /api/quality/checkpoints/batch/:batch_id
 * Get all checkpoints for a specific batch
 */
router.get('/checkpoints/batch/:batch_id', async (req, res) => {
    try {
        const { batch_id } = req.params;

        const query = `
            SELECT 
                id, batch_id, checkpoint_type, inspector, result,
                notes, corrective_action, metrics,
                CASE WHEN photo_data IS NOT NULL THEN true ELSE false END as has_photo,
                created_at
            FROM qa_checkpoints
            WHERE batch_id = $1
            ORDER BY created_at DESC
        `;

        const result = await db.query(query, [batch_id]);
        const checkpoints = result.rows.map(row => ({
            ...row,
            metrics: row.metrics ? JSON.parse(row.metrics) : null
        }));

        res.json({
            success: true,
            data: {
                batch_id,
                checkpoint_count: checkpoints.length,
                checkpoints
            }
        });

    } catch (error) {
        console.error('[QC] Error fetching batch checkpoints:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch checkpoints'
        });
    }
});

/**
 * GET /api/quality/standards/:checkpoint_type
 * Get quality standards for a specific checkpoint type
 */
router.get('/standards/:checkpoint_type', async (req, res) => {
    try {
        const { checkpoint_type } = req.params;

        const standards = QA_STANDARDS[checkpoint_type];
        if (!standards) {
            return res.status(404).json({
                success: false,
                error: `No standards found for checkpoint type: ${checkpoint_type}`,
                available_types: Object.keys(QA_STANDARDS)
            });
        }

        res.json({
            success: true,
            data: {
                checkpoint_type,
                ...standards
            }
        });

    } catch (error) {
        console.error('[QC] Error fetching standards:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch standards'
        });
    }
});

/**
 * GET /api/quality/checkpoints/list
 * List checkpoints with optional filters
 */
router.get('/checkpoints/list', async (req, res) => {
    try {
        const {
            farm_id,
            checkpoint_type,
            result,
            inspector,
            limit = 50,
            offset = 0
        } = req.query;

        let query = `
            SELECT 
                id, batch_id, checkpoint_type, inspector, result,
                notes, corrective_action,
                CASE WHEN photo_data IS NOT NULL THEN true ELSE false END as has_photo,
                created_at
            FROM qa_checkpoints
            WHERE 1=1
        `;
        const values = [];
        let paramCount = 1;

        if (farm_id) {
            query += ` AND farm_id = $${paramCount}`;
            values.push(farm_id);
            paramCount++;
        }

        if (checkpoint_type) {
            query += ` AND checkpoint_type = $${paramCount}`;
            values.push(checkpoint_type);
            paramCount++;
        }

        if (result) {
            query += ` AND result = $${paramCount}`;
            values.push(result);
            paramCount++;
        }

        if (inspector) {
            query += ` AND inspector ILIKE $${paramCount}`;
            values.push(`%${inspector}%`);
            paramCount++;
        }

        query += ` ORDER BY created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
        values.push(parseInt(limit), parseInt(offset));

        const result_data = await db.query(query, values);

        res.json({
            success: true,
            data: {
                checkpoints: result_data.rows,
                count: result_data.rows.length,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });

    } catch (error) {
        console.error('[QC] Error listing checkpoints:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list checkpoints'
        });
    }
});

/**
 * GET /api/quality/photos/:checkpoint_id
 * Get photo data for a specific checkpoint
 */
router.get('/photos/:checkpoint_id', async (req, res) => {
    try {
        const { checkpoint_id } = req.params;

        const query = `
            SELECT photo_data, checkpoint_type, batch_id, created_at
            FROM qa_checkpoints
            WHERE id = $1
        `;

        const result = await db.query(query, [checkpoint_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Checkpoint not found'
            });
        }

        const checkpoint = result.rows[0];

        if (!checkpoint.photo_data) {
            return res.status(404).json({
                success: false,
                error: 'No photo attached to this checkpoint'
            });
        }

        res.json({
            success: true,
            data: {
                checkpoint_id,
                checkpoint_type: checkpoint.checkpoint_type,
                batch_id: checkpoint.batch_id,
                photo_data: checkpoint.photo_data,
                timestamp: checkpoint.created_at
            }
        });

    } catch (error) {
        console.error('[QC] Error fetching photo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch photo'
        });
    }
});

/**
 * POST /api/quality/photos/upload
 * Upload a photo to an existing checkpoint
 */
router.post('/photos/upload', async (req, res) => {
    try {
        const { checkpoint_id, photo_data } = req.body;

        if (!checkpoint_id || !photo_data) {
            return res.status(400).json({
                success: false,
                error: 'Missing checkpoint_id or photo_data'
            });
        }

        const query = `
            UPDATE qa_checkpoints
            SET photo_data = $1
            WHERE id = $2
            RETURNING id, batch_id, checkpoint_type
        `;

        const result = await db.query(query, [photo_data, checkpoint_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Checkpoint not found'
            });
        }

        res.json({
            success: true,
            data: {
                checkpoint_id: result.rows[0].id,
                batch_id: result.rows[0].batch_id,
                checkpoint_type: result.rows[0].checkpoint_type,
                photo_uploaded: true
            }
        });

    } catch (error) {
        console.error('[QC] Error uploading photo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upload photo'
        });
    }
});

/**
 * GET /api/quality/stats
 * Get QA statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const { farm_id, days = 30 } = req.query;

        let whereClause = `WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'`;
        const values = [];

        if (farm_id) {
            whereClause += ` AND farm_id = $1`;
            values.push(farm_id);
        }

        const query = `
            SELECT 
                checkpoint_type,
                result,
                COUNT(*) as count
            FROM qa_checkpoints
            ${whereClause}
            GROUP BY checkpoint_type, result
            ORDER BY checkpoint_type, result
        `;

        const result = await db.query(query, values);

        // Calculate totals
        const stats = {
            total_checkpoints: 0,
            pass_count: 0,
            fail_count: 0,
            pending_count: 0,
            by_type: {}
        };

        result.rows.forEach(row => {
            const count = parseInt(row.count);
            stats.total_checkpoints += count;

            if (row.result === 'pass' || row.result === 'pass_with_notes') {
                stats.pass_count += count;
            } else if (row.result === 'fail') {
                stats.fail_count += count;
            } else if (row.result === 'pending') {
                stats.pending_count += count;
            }

            if (!stats.by_type[row.checkpoint_type]) {
                stats.by_type[row.checkpoint_type] = {
                    pass: 0,
                    fail: 0,
                    pending: 0,
                    total: 0
                };
            }

            stats.by_type[row.checkpoint_type][row.result === 'pass_with_notes' ? 'pass' : row.result] = count;
            stats.by_type[row.checkpoint_type].total += count;
        });

        // Calculate pass rate
        if (stats.total_checkpoints > 0) {
            stats.pass_rate = ((stats.pass_count / stats.total_checkpoints) * 100).toFixed(1);
        } else {
            stats.pass_rate = 0;
        }

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('[QC] Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch stats'
        });
    }
});

/**
 * GET /api/quality/dashboard
 * Get dashboard overview with recent activity
 */
router.get('/dashboard', async (req, res) => {
    try {
        const { farm_id } = req.query;

        let whereClause = 'WHERE 1=1';
        const values = [];

        if (farm_id) {
            whereClause += ' AND farm_id = $1';
            values.push(farm_id);
        }

        // Recent checkpoints
        const recentQuery = `
            SELECT 
                id, batch_id, checkpoint_type, inspector, result,
                notes, created_at
            FROM qa_checkpoints
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT 10
        `;

        // Failed checkpoints needing attention
        const failedQuery = `
            SELECT 
                id, batch_id, checkpoint_type, inspector,
                notes, corrective_action, created_at
            FROM qa_checkpoints
            ${whereClause}
            ${whereClause === 'WHERE 1=1' ? 'WHERE' : 'AND'} result = 'fail'
            ORDER BY created_at DESC
            LIMIT 5
        `;

        const [recentResult, failedResult] = await Promise.all([
            db.query(recentQuery, values),
            db.query(failedQuery, values)
        ]);

        res.json({
            success: true,
            data: {
                recent_checkpoints: recentResult.rows,
                failed_checkpoints: failedResult.rows,
                alerts: failedResult.rows.length
            }
        });

    } catch (error) {
        console.error('[QC] Error fetching dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard'
        });
    }
});

export default router;
