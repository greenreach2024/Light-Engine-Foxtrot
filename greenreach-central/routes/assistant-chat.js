/**
 * AI Assistant Chat Endpoint
 * ==========================
 * POST /api/assistant/chat
 *
 * Connects the Farm Assistant (Cheo) to GPT-4o-mini with function calling.
 * Maintains per-session conversation memory and executes farm tools on behalf of users.
 */

import { Router } from 'express';
import OpenAI from 'openai';
import { query, isDatabaseAvailable, getDatabase } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import { TOOL_CATALOG, executeTool } from './farm-ops-agent.js';
import { getLatestAnalyses } from '../services/market-analysis-agent.js';
import { getMarketDataAsync } from './market-intelligence.js';
import { getCropPricing } from './crop-pricing.js';
import { analyzeDemandPatterns } from '../services/wholesaleMemoryStore.js';
import farmStore from '../lib/farm-data-store.js';
import crypto from 'crypto';

const router = Router();

// ── OpenAI Client ──────────────────────────────────────────────────────
let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } else {
    console.warn('[Assistant Chat] OPENAI_API_KEY not set — assistant chat disabled');
  }
} catch (err) {
  console.error('[Assistant Chat] Failed to init OpenAI:', err.message);
}

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ── Conversation Memory (in-memory, 30-min TTL) ───────────────────────
const conversations = new Map();
const CONVERSATION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 20; // messages per conversation

function getConversation(id) {
  const conv = conversations.get(id);
  if (!conv) return null;
  if (Date.now() - conv.lastAccess > CONVERSATION_TTL_MS) {
    conversations.delete(id);
    return null;
  }
  conv.lastAccess = Date.now();
  return conv;
}

function upsertConversation(id, messages) {
  const trimmed = messages.slice(-MAX_HISTORY);
  conversations.set(id, { messages: trimmed, lastAccess: Date.now() });
}

// Periodic cleanup every 10 min
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAccess > CONVERSATION_TTL_MS) conversations.delete(id);
  }
}, 10 * 60 * 1000);

// ── GPT Function Definitions ──────────────────────────────────────────
const GPT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_daily_todo',
      description: 'Get today\'s prioritized task list for the farm. Returns scored tasks across categories: wholesale orders, harvest readiness, seeding windows, environment anomalies, alerts.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional filter: wholesale, harvest, seeding, anomaly, environment, ai-recommendation' },
          limit: { type: 'number', description: 'Max tasks to return' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_room_status',
      description: 'Get current environment readings and tray/crop status for a specific grow room.',
      parameters: {
        type: 'object',
        properties: {
          room_id: { type: 'string', description: 'The room identifier' }
        },
        required: ['room_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_orders',
      description: 'Get wholesale orders, optionally filtered by status (pending, confirmed, packed, shipped, delivered, cancelled).',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by order status' },
          limit: { type: 'number', description: 'Max orders to return' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_harvest_log',
      description: 'Get recent harvest records, optionally filtered by crop name.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Filter by crop name' },
          limit: { type: 'number', description: 'Max records to return' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_alerts',
      description: 'Get active system alerts and anomalies (sensor outages, environment drift, critical warnings).',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', description: 'Filter: critical, warning, info' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'dismiss_alert',
      description: 'Dismiss/acknowledge a system alert by its ID. Requires user confirmation before executing.',
      parameters: {
        type: 'object',
        properties: {
          alert_id: { type: 'string', description: 'The alert ID to dismiss' },
          reason: { type: 'string', description: 'Why the alert is being dismissed' }
        },
        required: ['alert_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_market_intelligence',
      description: 'Get current market prices, trends, and AI analysis for crops. Returns price trends (7-day/30-day), AI outlook (bullish/bearish/stable), and recommended actions.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Specific crop to look up. Omit for all crops.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_pricing_info',
      description: 'Get the farm\'s current retail and wholesale pricing for all crops.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_planting_recommendations',
      description: 'Get AI-powered smart planting recommendations scored by market trend, AI outlook, margin, and diversity.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_demand_forecast',
      description: 'Get the demand forecast for crops including wholesale order trends and market signals.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'auto_assign_devices',
      description: 'Auto-assign unassigned IoT devices (sensors, lights) to rooms/zones. This is a write operation — confirm with the user first.',
      parameters: {
        type: 'object',
        properties: {
          room_id: { type: 'string', description: 'Optional: only assign to this room' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'seed_benchmarks',
      description: 'Import crop benchmarks from the crop registry into benchmark configuration. This is a write operation — confirm with the user first.',
      parameters: {
        type: 'object',
        properties: {
          crops: { type: 'string', description: 'Comma-separated crop names to import. Omit for all.' }
        }
      }
    }
  }
];

// ── Build System Prompt with Farm Context ─────────────────────────────
async function buildSystemPrompt(farmId) {
  let farmContext = '';

  try {
    // Get basic farm info
    if (isDatabaseAvailable()) {
      const farmResult = await query(
        'SELECT farm_id, name, farm_type FROM farms WHERE farm_id = $1',
        [farmId]
      );
      if (farmResult.rows.length > 0) {
        const farm = farmResult.rows[0];
        farmContext += `Farm: ${farm.name} (${farm.farm_id}), Type: ${farm.farm_type || 'Indoor CEA'}\n`;
      }
    }
  } catch { /* non-fatal */ }

  // Get quick summary from daily todo (lightweight)
  try {
    const todoResult = await executeTool('get_daily_todo', { limit: 5 });
    if (todoResult?.ok) {
      farmContext += `Tasks today: ${todoResult.task_count} total`;
      if (todoResult.tasks?.length > 0) {
        const categories = {};
        todoResult.tasks.forEach(t => { categories[t.category] = (categories[t.category] || 0) + 1; });
        farmContext += ` (${Object.entries(categories).map(([k, v]) => `${v} ${k}`).join(', ')})`;
      }
      farmContext += '\n';
    }
  } catch { /* non-fatal */ }

  // Get alert count
  try {
    const alertResult = await executeTool('get_alerts', {});
    if (alertResult?.ok) {
      farmContext += `Active alerts: ${alertResult.count}\n`;
    }
  } catch { /* non-fatal */ }

  return `You are Cheo, the GreenReach Farm Assistant. You help farmers manage their indoor growing operations through natural conversation. You have access to real-time farm data and can execute actions.

CURRENT FARM STATE:
${farmContext || 'No farm data available — user may need to set up their farm first.'}

RULES:
- Be concise: 2-3 sentences unless the user asks for detail.
- When you call a tool, summarize the result naturally — don't dump raw JSON.
- For write operations (dismiss_alert, auto_assign_devices, seed_benchmarks), ALWAYS describe what you're about to do and ask for confirmation before calling the tool. Only call the tool after the user confirms.
- If you can't help, say so briefly and suggest what you CAN do.
- Use Canadian English (colour, favourite, centre).
- Never fabricate data — only report what tools return.
- Format responses with simple HTML: <strong> for emphasis, <ul>/<li> for lists. Keep it clean.
- When listing tasks or items, show the top 3-5 most relevant, mention the total count.
- For prices, always show currency (CAD).`;
}

// ── Tool Execution Layer ──────────────────────────────────────────────
// Tools that need DB access and aren't in farm-ops-agent TOOL_CATALOG
async function executeExtendedTool(toolName, params, farmId) {
  // First check if it's in the standard catalog
  if (TOOL_CATALOG[toolName]) {
    return await executeTool(toolName, params);
  }

  const pool = getDatabase();

  switch (toolName) {
    case 'get_market_intelligence': {
      const results = {};
      try {
        const marketData = await getMarketDataAsync(pool);
        let aiAnalyses = [];
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        const cropFilter = params.crop?.toLowerCase();
        for (const [product, data] of Object.entries(marketData)) {
          if (cropFilter && !product.toLowerCase().includes(cropFilter)) continue;
          const ai = aiMap[product] || null;
          results[product] = {
            trend: data.trend,
            trendPercent: data.trendPercent,
            latestPrice: data.latestPrice,
            unit: data.unit,
            observationCount: data.observationCount,
            aiOutlook: ai?.outlook || null,
            aiAction: ai?.action || null,
            aiConfidence: ai?.confidence || null,
            aiReasoning: ai?.reasoning || null
          };
        }
      } catch (err) {
        return { ok: false, error: err.message };
      }
      return { ok: true, crops: results, count: Object.keys(results).length };
    }

    case 'get_pricing_info': {
      try {
        const pricing = await getCropPricing();
        return { ok: true, crops: pricing, count: pricing.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_planting_recommendations': {
      try {
        const pool = getDatabase();
        const marketData = await getMarketDataAsync(pool);
        const cropPricing = await getCropPricing();

        let currentAssignments = [];
        if (isDatabaseAvailable()) {
          try {
            const result = await query(
              'SELECT crop_sku, COUNT(*) as count FROM planting_assignments WHERE farm_id = $1 GROUP BY crop_sku',
              [farmId]
            );
            currentAssignments = result.rows || [];
          } catch { /* ok */ }
        }

        let aiAnalyses = [];
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        const totalAssigned = currentAssignments.reduce((sum, a) => sum + parseInt(a.count, 10), 0) || 1;
        const recommendations = [];

        for (const [product, data] of Object.entries(marketData)) {
          const ai = aiMap[product] || null;
          const pricingMatch = cropPricing.find(c =>
            c.crop.toLowerCase().includes(product.toLowerCase()) ||
            product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
          );
          if (!pricingMatch) continue;

          const currentCount = parseInt(currentAssignments.find(a => a.crop_sku === pricingMatch.crop)?.count || 0, 10);

          let trendScore = 50;
          if (data.trend === 'increasing') trendScore = 50 + Math.min(data.trendPercent, 50);
          else if (data.trend === 'decreasing') trendScore = Math.max(50 - Math.abs(data.trendPercent), 0);

          let aiScore = 50;
          if (ai?.outlook === 'bullish') aiScore = 80;
          else if (ai?.outlook === 'bearish') aiScore = 20;
          if (ai?.action === 'increase_production') aiScore = Math.min(aiScore + 15, 100);
          else if (ai?.action === 'reduce_production') aiScore = Math.max(aiScore - 15, 0);

          const marginScore = Math.min((pricingMatch.wholesalePrice || 0) / 15 * 100, 100);

          const cropShare = currentCount / totalAssigned;
          let diversityScore = 100;
          if (currentCount > 0) diversityScore = Math.max(100 - cropShare * 200, 10);

          const composite = Math.round(
            trendScore * 0.30 + aiScore * 0.25 + marginScore * 0.20 + diversityScore * 0.25
          );

          const reasons = [];
          if (data.trend === 'increasing' && data.trendPercent >= 5) reasons.push(`prices up ${data.trendPercent}%`);
          if (ai?.outlook === 'bullish') reasons.push('AI outlook bullish');
          if (ai?.action === 'increase_production') reasons.push('AI recommends increasing production');
          if (currentCount === 0) reasons.push('not currently growing — diversification opportunity');
          else if (cropShare > 0.3) reasons.push(`${Math.round(cropShare * 100)}% of capacity — over-concentrated`);
          if (pricingMatch.wholesalePrice >= 10) reasons.push(`strong margin ($${pricingMatch.wholesalePrice}/unit)`);

          const priority = composite >= 70 ? 'high' : composite >= 45 ? 'medium' : 'low';

          recommendations.push({
            crop: pricingMatch.crop, priority, score: composite,
            reasoning: ai?.reasoning || reasons.join('; ') || `Composite score ${composite}`,
            marketTrend: data.trend, trendPercent: data.trendPercent,
            currentlyGrowing: currentCount, confidence: ai?.confidence || (data.observationCount >= 10 ? 'high' : 'medium'),
            aiOutlook: ai?.outlook || null, aiAction: ai?.action || null,
          });
        }

        return { ok: true, recommendations: recommendations.sort((a, b) => b.score - a.score), generatedAt: new Date().toISOString() };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'get_demand_forecast': {
      try {
        const pool = getDatabase();
        const marketData = await getMarketDataAsync(pool);
        const cropPricing = await getCropPricing();

        let aiAnalyses = [];
        let demandSignals = {};
        try { aiAnalyses = pool ? await getLatestAnalyses(pool) : []; } catch { /* ok */ }
        try { demandSignals = await analyzeDemandPatterns() || {}; } catch { /* ok */ }

        const aiMap = {};
        for (const a of aiAnalyses) aiMap[a.product] = a;

        const forecast = [];
        for (const [product, data] of Object.entries(marketData)) {
          const pricingMatch = cropPricing.find(c =>
            c.crop.toLowerCase().includes(product.toLowerCase()) ||
            product.toLowerCase().includes(c.crop.toLowerCase().split(' ')[0])
          );
          const ai = aiMap[product] || null;
          const demand = demandSignals[product] || null;

          let confidence = 'medium';
          if (ai?.confidence) confidence = ai.confidence;
          else if (data.observationCount >= 20) confidence = 'high';
          else if ((data.observationCount || 0) < 5) confidence = 'low';

          forecast.push({
            product, trendPercent: data.trendPercent, trend: data.trend, confidence,
            reasoning: ai?.reasoning || `Market trend: ${data.trend}`,
            pricePerUnit: pricingMatch?.wholesalePrice || null,
            priceCAD: data.avgPriceCAD || null,
            aiOutlook: ai?.outlook || null, aiAction: ai?.action || null,
            aiForecastPrice: ai?.price_forecast ? parseFloat(ai.price_forecast) : null,
            wholesaleDemand: demand ? {
              totalQty: demand.network_total_qty,
              orderCount: demand.network_order_count,
              trend: demand.network_trend,
            } : null,
            dataSource: data.dataSource || 'hardcoded',
          });
        }

        const averageTrend = forecast.length > 0
          ? Math.round((forecast.reduce((s, f) => s + f.trendPercent, 0) / forecast.length) * 10) / 10
          : 0;

        return {
          ok: true,
          forecast: forecast.sort((a, b) => Math.abs(b.trendPercent) - Math.abs(a.trendPercent)),
          averageTrend,
          generatedAt: new Date().toISOString()
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    default:
      return { ok: false, error: `Unknown tool: ${toolName}` };
  }
}

// ── Main Chat Endpoint ────────────────────────────────────────────────

/**
 * POST /api/assistant/chat
 * Body: { message, conversation_id?, farm_id? }
 * Returns: { reply, conversation_id, actions?, tool_calls? }
 */
router.post('/chat', async (req, res) => {
  if (!openai) {
    return res.status(503).json({
      ok: false,
      error: 'AI assistant not available — OPENAI_API_KEY not configured'
    });
  }

  const { message, conversation_id, farm_id } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const sanitizedMessage = message.trim().slice(0, 2000);
  const farmId = farm_id || req.session?.farm_id || 'demo-farm';
  const convId = conversation_id || crypto.randomUUID();
  const toolCallResults = [];

  try {
    // Build conversation
    const existing = getConversation(convId);
    const history = existing ? [...existing.messages] : [];

    // Build system prompt (only on first message or every 5 messages to save tokens)
    let systemPrompt;
    if (history.length === 0 || history.length % 10 === 0) {
      systemPrompt = await buildSystemPrompt(farmId);
    } else {
      // Reuse the system message from history
      const sysMsg = history.find(m => m.role === 'system');
      systemPrompt = sysMsg?.content || await buildSystemPrompt(farmId);
    }

    // Assemble messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.filter(m => m.role !== 'system'),
      { role: 'user', content: sanitizedMessage }
    ];

    // Call GPT with function calling
    let completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: GPT_TOOLS,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 800
    });

    let assistantMessage = completion.choices[0].message;
    let loopCount = 0;
    const MAX_TOOL_LOOPS = 5;

    // Handle tool calls iteratively
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && loopCount < MAX_TOOL_LOOPS) {
      loopCount++;

      // Add assistant's tool-calling message to history
      messages.push(assistantMessage);

      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs = {};
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch { /* empty args */ }

        console.log(`[Assistant Chat] Tool call: ${fnName}(${JSON.stringify(fnArgs)})`);

        let toolResult;
        try {
          // Write tools: auto-confirm since GPT is supposed to ask user first in conversation
          if (TOOL_CATALOG[fnName]?.category === 'write') {
            fnArgs.confirm = true;
          }
          toolResult = await executeExtendedTool(fnName, fnArgs, farmId);
        } catch (err) {
          toolResult = { ok: false, error: err.message };
        }

        toolCallResults.push({
          tool: fnName,
          params: fnArgs,
          success: toolResult?.ok !== false
        });

        // Add tool result to messages
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });
      }

      // Call GPT again with tool results
      completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: GPT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 800
      });

      assistantMessage = completion.choices[0].message;
    }

    const replyText = assistantMessage.content || 'I processed your request but have nothing to add.';

    // Track AI usage
    trackAiUsage({
      farm_id: farmId,
      endpoint: 'assistant-chat',
      model: MODEL,
      prompt_tokens: completion.usage?.prompt_tokens,
      completion_tokens: completion.usage?.completion_tokens,
      total_tokens: completion.usage?.total_tokens,
      estimated_cost: estimateChatCost(MODEL, completion.usage?.prompt_tokens || 0, completion.usage?.completion_tokens || 0),
      status: 'success'
    });

    // Save conversation history
    const updatedHistory = [
      ...history,
      { role: 'user', content: sanitizedMessage },
      { role: 'assistant', content: replyText }
    ];
    upsertConversation(convId, updatedHistory);

    return res.json({
      ok: true,
      reply: replyText,
      conversation_id: convId,
      tool_calls: toolCallResults.length > 0 ? toolCallResults : undefined,
      model: MODEL
    });

  } catch (error) {
    console.error('[Assistant Chat] Error:', error.message);

    trackAiUsage({
      farm_id: farmId,
      endpoint: 'assistant-chat',
      model: MODEL,
      estimated_cost: 0,
      status: 'error',
      error_message: error.message
    });

    return res.status(500).json({
      ok: false,
      error: 'Failed to process your message. Please try again.'
    });
  }
});

/**
 * GET /api/assistant/status
 * Returns whether the assistant chat is available
 */
router.get('/status', (req, res) => {
  res.json({
    ok: true,
    available: !!openai,
    model: MODEL,
    active_conversations: conversations.size
  });
});

export default router;
