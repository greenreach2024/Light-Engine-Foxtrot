/**
 * AI Agent Routes for Light Engine
 * Provides endpoints for intelligent assistant with action capabilities
 */

import express from 'express';
import { parseCommand, executeAction, SYSTEM_CAPABILITIES } from '../../services/ai-agent.js';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';

const router = express.Router();

// Rate limiting state (simple in-memory counter)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 20; // Max 20 requests per minute per farm

/**
 * Simple rate limiting middleware
 */
function rateLimiter(req, res, next) {
  const farmId = req.farmId;
  const now = Date.now();
  
  if (!rateLimitMap.has(farmId)) {
    rateLimitMap.set(farmId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  const limiter = rateLimitMap.get(farmId);
  
  if (now > limiter.resetAt) {
    // Reset window
    limiter.count = 1;
    limiter.resetAt = now + RATE_LIMIT_WINDOW;
    return next();
  }
  
  if (limiter.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'rate_limit_exceeded',
      message: 'Too many AI requests. Please wait a moment.',
      retry_after: Math.ceil((limiter.resetAt - now) / 1000)
    });
  }
  
  limiter.count++;
  next();
}

/**
 * POST /api/farm-sales/ai-agent/chat
 * Main chat endpoint - parse command and execute action
 */
router.post('/chat', farmAuthMiddleware, rateLimiter, async (req, res) => {
  try {
    const { message, history, confirm_action } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'invalid_request',
        message: 'Message is required'
      });
    }
    
    // Parse user command
    const intent = await parseCommand(message, history || []);
    
    // Check if action requires confirmation and wasn't confirmed yet
    if (intent.requires_confirmation && !confirm_action) {
      return res.json({
        type: 'confirmation_required',
        intent: intent,
        message: intent.response
      });
    }
    
    // Execute the action
    const result = await executeAction(intent, {
      farmStores: req.app.get('farmStores'),
      farmId: req.farmId,
      userId: req.userId
    });
    
    // Return combined response
    res.json({
      type: 'action_completed',
      intent: intent,
      result: result,
      message: result.success ? 
        `${intent.response} ${result.message}` : 
        `Sorry, I encountered an error: ${result.message}`
    });
    
  } catch (error) {
    console.error('[AI Agent] Chat error:', error);
    
    // Check if it's an OpenAI API error
    if (error.message.includes('OpenAI')) {
      return res.status(503).json({
        error: 'ai_unavailable',
        message: 'AI assistant is temporarily unavailable. Please try again later.'
      });
    }
    
    res.status(500).json({
      error: 'internal_error',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/ai-agent/capabilities
 * List all available AI agent capabilities
 */
router.get('/capabilities', farmAuthMiddleware, (req, res) => {
  res.json({
    capabilities: SYSTEM_CAPABILITIES,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    status: process.env.OPENAI_API_KEY ? 'available' : 'not_configured'
  });
});

/**
 * GET /api/farm-sales/ai-agent/status
 * Check AI agent status and configuration
 */
router.get('/status', farmAuthMiddleware, (req, res) => {
  const apiKeyConfigured = !!process.env.OPENAI_API_KEY;
  
  res.json({
    status: apiKeyConfigured ? 'ready' : 'not_configured',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    api_key_set: apiKeyConfigured,
    rate_limit: {
      max_requests: RATE_LIMIT_MAX,
      window_seconds: RATE_LIMIT_WINDOW / 1000
    }
  });
});

/**
 * POST /api/farm-sales/ai-agent/feedback
 * Submit feedback about AI response quality (for future improvements)
 */
router.post('/feedback', farmAuthMiddleware, async (req, res) => {
  try {
    const { message_id, rating, comment } = req.body;
    
    // Log feedback (could be stored in database for analysis)
    console.log('[AI Agent] Feedback received:', {
      farm_id: req.farmId,
      message_id,
      rating,
      comment,
      timestamp: new Date().toISOString()
    });
    
    res.json({
      success: true,
      message: 'Thank you for your feedback!'
    });
    
  } catch (error) {
    console.error('[AI Agent] Feedback error:', error);
    res.status(500).json({
      error: 'internal_error',
      message: error.message
    });
  }
});

export default router;
