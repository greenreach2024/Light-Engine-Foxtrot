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

export default router;
