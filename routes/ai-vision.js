/**
 * AI Vision Analysis for Plant Health Quality Control
 * Uses OpenAI Vision API to analyze plant photos
 */

import express from 'express';
import { query as db } from '../lib/database.js';

const router = express.Router();

// Check if OpenAI is available
let OpenAI;
let openai;
try {
    const openaiModule = await import('openai');
    OpenAI = openaiModule.default;
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        console.log('[AI Vision] OpenAI initialized successfully');
    } else {
        console.warn('[AI Vision] OPENAI_API_KEY not set - using fallback analysis');
    }
} catch (error) {
    console.warn('[AI Vision] OpenAI not available - using fallback analysis:', error.message);
}

// Analysis prompt for plant health assessment
const PLANT_HEALTH_PROMPT = `You are an expert in indoor hydroponic farming and plant health assessment. 
Analyze this plant photo and provide a detailed health assessment.

Evaluate these aspects:
1. Overall Health Score (0-100)
2. Color Quality - vibrant green, yellowing, browning, proper coloration
3. Size & Growth - appropriate for stage, uniform, stunted, overgrown
4. Disease Signs - mold, rot, spots, discoloration, wilting
5. Pest Damage - holes, bite marks, webbing, visible insects
6. Structural Issues - broken leaves, poor form, weak stems

Return ONLY a JSON object with this exact structure (no markdown, no code blocks):
{
  "health_score": 85,
  "assessment": "healthy|concerning|poor",
  "color_quality": "vibrant green with excellent coloration",
  "size_growth": "appropriate size for growth stage",
  "disease_signs": "no visible disease",
  "pest_damage": "no pest damage detected",
  "structural_issues": "strong structure",
  "recommendations": ["continue current care", "monitor for pests"],
  "pass_qa": true
}`;

/**
 * Fallback analysis when AI is unavailable
 */
function getFallbackAnalysis() {
    return {
        health_score: 85,
        assessment: 'healthy',
        color_quality: 'analysis unavailable - manual review recommended',
        size_growth: 'analysis unavailable - manual review recommended',
        disease_signs: 'no AI analysis available',
        pest_damage: 'no AI analysis available',
        structural_issues: 'manual inspection recommended',
        recommendations: ['AI vision unavailable', 'manual quality check recommended'],
        pass_qa: true,
        ai_available: false
    };
}

/**
 * Use OpenAI Vision API to analyze plant health
 */
async function analyzeWithAI(imageBase64, cropType = null) {
    if (!openai) {
        console.warn('[AI Vision] OpenAI not configured - using fallback');
        return getFallbackAnalysis();
    }

    try {
        const imageUrl = `data:image/jpeg;base64,${imageBase64}`;
        
        let prompt = PLANT_HEALTH_PROMPT;
        if (cropType) {
            prompt += `\n\nCrop Type: ${cropType}`;
        }

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: imageUrl } }
                    ]
                }
            ],
            max_tokens: 500,
            temperature: 0.3
        });

        const resultText = response.choices[0].message.content.trim();
        
        // Remove markdown formatting if present
        const cleanedText = resultText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const analysis = JSON.parse(cleanedText);
        analysis.ai_available = true;

        return analysis;

    } catch (error) {
        console.error('[AI Vision] Analysis failed:', error);
        const fallback = getFallbackAnalysis();
        fallback.error = error.message;
        return fallback;
    }
}

/**
 * POST /api/qa/analyze-photo
 * Analyze a single plant photo for health assessment
 */
router.post('/analyze-photo', async (req, res) => {
    try {
        const { image_data, crop_type, batch_id } = req.body;

        if (!image_data) {
            return res.status(400).json({
                success: false,
                error: 'Missing image_data (base64 encoded)'
            });
        }

        // Remove data URL prefix if present
        const base64Data = image_data.includes(',') 
            ? image_data.split(',')[1] 
            : image_data;

        console.log(`[AI Vision] Analyzing photo for batch ${batch_id || 'unknown'}, crop: ${crop_type || 'unknown'}`);

        const analysis = await analyzeWithAI(base64Data, crop_type);

        res.json({
            success: true,
            data: {
                analysis,
                batch_id,
                crop_type,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('[AI Vision] Error in analyze-photo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze photo',
            message: error.message
        });
    }
});

/**
 * POST /api/qa/checklist-photo
 * Complete QA workflow: analyze photo + create checkpoint
 */
router.post('/checklist-photo', async (req, res) => {
    try {
        const {
            batch_id,
            checkpoint_type,
            inspector,
            crop_type,
            image_data,
            notes,
            farm_id
        } = req.body;

        // Validate required fields
        if (!batch_id || !checkpoint_type || !inspector || !image_data) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: batch_id, checkpoint_type, inspector, image_data'
            });
        }

        // Remove data URL prefix if present
        const base64Data = image_data.includes(',') 
            ? image_data.split(',')[1] 
            : image_data;

        console.log(`[AI Vision] Checklist photo QA for batch ${batch_id}, type: ${checkpoint_type}`);

        // Analyze photo with AI
        const analysis = await analyzeWithAI(base64Data, crop_type);

        // Determine QA result based on AI analysis
        let result;
        if (!analysis.ai_available) {
            result = 'pending'; // Manual review needed
        } else if (analysis.pass_qa && analysis.health_score >= 80) {
            result = analysis.health_score >= 90 ? 'pass' : 'pass_with_notes';
        } else {
            result = 'fail';
        }

        // Create QA checkpoint with AI analysis
        const insertQuery = `
            INSERT INTO qa_checkpoints (
                batch_id, checkpoint_type, inspector, result,
                notes, photo_data, metrics, farm_id, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id, created_at
        `;

        const combinedNotes = notes 
            ? `${notes}\n\nAI Analysis: ${analysis.assessment} (score: ${analysis.health_score}/100)`
            : `AI Analysis: ${analysis.assessment} (score: ${analysis.health_score}/100)`;

        const metrics = {
            health_score: analysis.health_score,
            assessment: analysis.assessment,
            color_quality: analysis.color_quality,
            size_growth: analysis.size_growth,
            disease_signs: analysis.disease_signs,
            pest_damage: analysis.pest_damage,
            structural_issues: analysis.structural_issues,
            ai_recommendations: analysis.recommendations,
            ai_available: analysis.ai_available
        };

        const values = [
            batch_id,
            checkpoint_type,
            inspector,
            result,
            combinedNotes,
            image_data, // Store full data URL for display
            JSON.stringify(metrics),
            farm_id || null
        ];

        const checkpointResult = await db(insertQuery, values);
        const checkpoint = checkpointResult.rows[0];

        res.json({
            success: true,
            data: {
                checkpoint_id: checkpoint.id,
                batch_id,
                checkpoint_type,
                result,
                analysis,
                timestamp: checkpoint.created_at
            }
        });

    } catch (error) {
        console.error('[AI Vision] Error in checklist-photo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process checklist photo',
            message: error.message
        });
    }
});

/**
 * GET /api/qa/quality-trends
 * AI Vision Phase 3, T30: Quality trend analysis over time
 * Aggregates health_score from qa_checkpoints by crop/period
 *
 * Feedback loop: 3 (Spectrum → Quality) — OBSERVE mode
 * Connects quality scores to spectrum/recipe inputs over time
 *
 * Query params:
 *   ?crop=genovese-basil     — filter by crop (from batch_id prefix)
 *   ?farm_id=FARM-...        — filter by farm
 *   ?since=2025-01-01        — start date (default 90 days ago)
 *   ?period=week             — grouping: day|week|month (default week)
 */
router.get('/quality-trends', async (req, res) => {
    try {
        const { crop, farm_id, period = 'week' } = req.query;
        const since = req.query.since || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

        // Map period to PostgreSQL date_trunc interval
        const validPeriods = { day: 'day', week: 'week', month: 'month' };
        const truncPeriod = validPeriods[period] || 'week';

        // Build WHERE clauses
        const conditions = ['created_at >= $1'];
        const params = [since];
        let paramIdx = 2;

        if (farm_id) {
            conditions.push(`farm_id = $${paramIdx++}`);
            params.push(farm_id);
        }
        if (crop) {
            // batch_id often starts with crop name or group reference — use ILIKE
            conditions.push(`batch_id ILIKE $${paramIdx++}`);
            params.push(`%${crop}%`);
        }

        const whereClause = conditions.join(' AND ');

        // Aggregate health scores by period
        const trendQuery = `
            SELECT
                date_trunc('${truncPeriod}', created_at) AS period_start,
                COUNT(*) AS checkpoint_count,
                ROUND(AVG((metrics->>'health_score')::numeric), 1) AS avg_health_score,
                ROUND(MIN((metrics->>'health_score')::numeric), 1) AS min_health_score,
                ROUND(MAX((metrics->>'health_score')::numeric), 1) AS max_health_score,
                COUNT(*) FILTER (WHERE result = 'pass' OR result = 'pass_with_notes') AS pass_count,
                COUNT(*) FILTER (WHERE result = 'fail') AS fail_count,
                ROUND(
                    COUNT(*) FILTER (WHERE result = 'pass' OR result = 'pass_with_notes')::numeric /
                    NULLIF(COUNT(*)::numeric, 0) * 100, 1
                ) AS pass_rate_pct
            FROM qa_checkpoints
            WHERE ${whereClause}
              AND metrics->>'health_score' IS NOT NULL
            GROUP BY period_start
            ORDER BY period_start ASC
        `;

        const trendResult = await db(trendQuery, params);

        // Overall summary
        const summaryQuery = `
            SELECT
                COUNT(*) AS total_checkpoints,
                ROUND(AVG((metrics->>'health_score')::numeric), 1) AS avg_health_score,
                ROUND(STDDEV((metrics->>'health_score')::numeric), 1) AS stddev_health_score,
                COUNT(DISTINCT batch_id) AS unique_batches,
                COUNT(DISTINCT farm_id) AS unique_farms,
                COUNT(*) FILTER (WHERE result = 'pass' OR result = 'pass_with_notes') AS total_pass,
                COUNT(*) FILTER (WHERE result = 'fail') AS total_fail
            FROM qa_checkpoints
            WHERE ${whereClause}
              AND metrics->>'health_score' IS NOT NULL
        `;

        const summaryResult = await db(summaryQuery, params);
        const summary = summaryResult.rows[0] || {};

        // Compute trend direction from first/last period
        const trends = trendResult.rows || [];
        let trend_direction = 'stable';
        if (trends.length >= 2) {
            const first = parseFloat(trends[0].avg_health_score);
            const last = parseFloat(trends[trends.length - 1].avg_health_score);
            const delta = last - first;
            if (delta > 2) trend_direction = 'improving';
            else if (delta < -2) trend_direction = 'declining';
        }

        res.json({
            success: true,
            data: {
                period: truncPeriod,
                since,
                filters: { crop: crop || null, farm_id: farm_id || null },
                summary: {
                    total_checkpoints: parseInt(summary.total_checkpoints) || 0,
                    avg_health_score: parseFloat(summary.avg_health_score) || null,
                    stddev_health_score: parseFloat(summary.stddev_health_score) || null,
                    unique_batches: parseInt(summary.unique_batches) || 0,
                    unique_farms: parseInt(summary.unique_farms) || 0,
                    pass_rate_pct: summary.total_pass && summary.total_checkpoints
                        ? +(((parseInt(summary.total_pass) / parseInt(summary.total_checkpoints)) * 100).toFixed(1))
                        : null,
                    trend_direction
                },
                trends: trends.map(t => ({
                    period_start: t.period_start,
                    checkpoint_count: parseInt(t.checkpoint_count),
                    avg_health_score: parseFloat(t.avg_health_score),
                    min_health_score: parseFloat(t.min_health_score),
                    max_health_score: parseFloat(t.max_health_score),
                    pass_count: parseInt(t.pass_count),
                    fail_count: parseInt(t.fail_count),
                    pass_rate_pct: parseFloat(t.pass_rate_pct)
                }))
            }
        });

    } catch (error) {
        console.error('[AI Vision] Error in quality-trends:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to compute quality trends',
            message: error.message
        });
    }
});

export default router;
