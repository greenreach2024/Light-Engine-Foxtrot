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
import logger from '../utils/logger.js';
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
  for (const [id, action] of pendingActions) {
    if (now - action.created > CONVERSATION_TTL_MS) pendingActions.delete(id);
  }
}, 10 * 60 * 1000);

// ── Pending Write Actions (require user confirmation) ─────────────────
const pendingActions = new Map();

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
  },
  // --- Phase 2A: New Read Tools ---
  {
    type: 'function',
    function: {
      name: 'get_pricing_decisions',
      description: 'Get recent pricing decisions and their outcomes — shows what prices were changed, when, and by whom.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Filter by crop name' },
          limit: { type: 'number', description: 'Max results (default 10)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_capacity',
      description: 'Get farm capacity utilization — total tray slots, used, available, and utilization percentage.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional, uses session default)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_summary',
      description: 'Get current crop inventory — quantities, statuses, and zones for all crops in stock.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_crop_info',
      description: 'Get detailed crop registry info — growth parameters, days to harvest, pricing, categories. Use to answer questions about how to grow a specific crop.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name to look up. Omit for all crops.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_farm_insights',
      description: 'Get AI-generated environmental insights and recipe recommendations for the farm.',
      parameters: {
        type: 'object',
        properties: {
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_ai_recommendations',
      description: 'Get AI Pusher recommendations from network intelligence — cross-farm insights on production, demand, and growing conditions.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max recommendations to return' }
        }
      }
    }
  },
  // --- Phase 2B: Write Tools ---
  {
    type: 'function',
    function: {
      name: 'update_crop_price',
      description: 'Update the retail or wholesale price for a crop. This is a WRITE operation — you MUST describe the change and ask the user to confirm before calling this tool.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name (e.g. "Genovese Basil")' },
          retail_price: { type: 'number', description: 'New retail price in CAD' },
          wholesale_price: { type: 'number', description: 'New wholesale price in CAD' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['crop']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_planting_assignment',
      description: 'Schedule a new planting — assign a crop to a group/zone with seed and harvest dates. WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          crop_name: { type: 'string', description: 'Crop to plant' },
          group_id: { type: 'string', description: 'Group/zone ID to plant in' },
          seed_date: { type: 'string', description: 'Seed date (YYYY-MM-DD). Defaults to today.' },
          harvest_date: { type: 'string', description: 'Expected harvest date (YYYY-MM-DD)' },
          notes: { type: 'string', description: 'Optional notes' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['crop_name', 'group_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'mark_harvest_complete',
      description: 'Record a completed harvest — crop, quantity, zone, yield. WRITE operation — confirm details with user first.',
      parameters: {
        type: 'object',
        properties: {
          crop: { type: 'string', description: 'Crop name harvested' },
          quantity: { type: 'number', description: 'Number of trays/units harvested' },
          zone: { type: 'string', description: 'Zone harvested from' },
          unit: { type: 'string', description: 'Unit type (trays, lbs, units). Default: trays' },
          yield_lbs: { type: 'number', description: 'Yield in pounds (optional)' },
          notes: { type: 'string', description: 'Optional notes' }
        },
        required: ['crop', 'quantity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_order_status',
      description: 'Update a wholesale order status (e.g. confirmed → packed → shipped → delivered). WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order ID (e.g. WO-2026-0047)' },
          status: { type: 'string', enum: ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'], description: 'New status' }
        },
        required: ['order_id', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_inventory_item',
      description: 'Add stock to inventory or create a new inventory entry for a crop. WRITE operation — confirm with user first.',
      parameters: {
        type: 'object',
        properties: {
          crop_name: { type: 'string', description: 'Crop name' },
          quantity: { type: 'number', description: 'Quantity to add' },
          unit: { type: 'string', description: 'Unit (units, lbs, trays). Default: units' },
          zone: { type: 'string', description: 'Storage zone (optional)' },
          status: { type: 'string', description: 'Status (available, reserved, damaged). Default: available' },
          farm_id: { type: 'string', description: 'Farm ID (optional)' }
        },
        required: ['crop_name', 'quantity']
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
- For WRITE operations (update_crop_price, create_planting_assignment, mark_harvest_complete, update_order_status, add_inventory_item, dismiss_alert, auto_assign_devices, seed_benchmarks): you MUST describe the proposed change and ask the user to confirm BEFORE calling the tool. Do NOT call write tools until the user says "yes", "confirm", "do it", or similar.
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

  // ── Handle pending action confirmations ──
  const isConfirm = /^(__confirm_action__|yes|yeah|yep|confirm|do it|go ahead|proceed|approved|sure|ok)$/i.test(sanitizedMessage);
  const isCancel = /^(__cancel_action__|cancel|no|nah|never mind|abort|don't|stop)$/i.test(sanitizedMessage);

  if (pendingActions.has(convId) && (isConfirm || isCancel)) {
    const pending = pendingActions.get(convId);
    pendingActions.delete(convId);

    const existing = getConversation(convId);
    const history = existing ? [...existing.messages] : [];

    if (isCancel) {
      const cancelReply = 'Cancelled — no changes were made.';
      upsertConversation(convId, [...history, { role: 'user', content: sanitizedMessage }, { role: 'assistant', content: cancelReply }]);
      return res.json({ ok: true, reply: cancelReply, conversation_id: convId });
    }

    // Execute the confirmed write action
    try {
      pending.params.confirm = true;
      const result = await executeExtendedTool(pending.tool, pending.params, pending.farmId);

      toolCallResults.push({ tool: pending.tool, params: pending.params, success: result?.ok !== false });

      const systemPrompt = await buildSystemPrompt(farmId);
      const summaryCompletion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.filter(m => m.role !== 'system'),
          { role: 'user', content: 'I confirmed the action.' },
          { role: 'system', content: `User confirmed. Tool "${pending.tool}" executed. Result: ${JSON.stringify(result).slice(0, 1500)}. Summarize what was done concisely.` }
        ],
        temperature: 0.7,
        max_tokens: 400
      });

      const replyText = summaryCompletion.choices[0].message?.content || 'Done — action completed.';

      trackAiUsage({
        farm_id: farmId, endpoint: 'assistant-chat', model: MODEL,
        prompt_tokens: summaryCompletion.usage?.prompt_tokens,
        completion_tokens: summaryCompletion.usage?.completion_tokens,
        total_tokens: summaryCompletion.usage?.total_tokens,
        estimated_cost: estimateChatCost(MODEL, summaryCompletion.usage?.prompt_tokens || 0, summaryCompletion.usage?.completion_tokens || 0),
        status: 'success'
      });

      upsertConversation(convId, [...history, { role: 'user', content: sanitizedMessage }, { role: 'assistant', content: replyText }]);

      return res.json({
        ok: true, reply: replyText, conversation_id: convId,
        tool_calls: toolCallResults.length > 0 ? toolCallResults : undefined, model: MODEL
      });
    } catch (err) {
      return res.json({ ok: true, reply: `Sorry, the action failed: ${err.message}`, conversation_id: convId });
    }
  }

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
          // Write tools: intercept and require user confirmation
          const isWriteTool = TOOL_CATALOG[fnName]?.category === 'write';
          if (isWriteTool) {
            // Store as pending — don't execute yet
            pendingActions.set(convId, { tool: fnName, params: fnArgs, farmId, created: Date.now() });
            toolResult = {
              status: 'pending_confirmation',
              message: 'This action requires user confirmation before execution. Describe what will happen and ask the user to confirm or cancel.',
              tool: fnName,
              params: fnArgs
            };
          } else {
            toolResult = await executeExtendedTool(fnName, fnArgs, farmId);
          }
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

    // Check if there's a pending action to signal to the frontend
    const pendingAction = pendingActions.get(convId);

    return res.json({
      ok: true,
      reply: replyText,
      conversation_id: convId,
      tool_calls: toolCallResults.length > 0 ? toolCallResults : undefined,
      pending_action: pendingAction ? { tool: pendingAction.tool, params: pendingAction.params } : undefined,
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

// ── Morning Briefing Endpoint ─────────────────────────────────────────

/**
 * GET /api/assistant/morning-briefing?farm_id=...
 * Returns a pre-composed daily briefing without an LLM call.
 * Fast, deterministic, cached for 4 hours.
 */
const briefingCache = new Map();
const BRIEFING_TTL_MS = 4 * 60 * 60 * 1000;

router.get('/morning-briefing', async (req, res) => {
  const farmId = req.query.farm_id || req.session?.farm_id || 'demo-farm';
  const cacheKey = `${farmId}:${new Date().toISOString().slice(0, 10)}`;

  // Return cached briefing if fresh
  const cached = briefingCache.get(cacheKey);
  if (cached && Date.now() - cached.created < BRIEFING_TTL_MS) {
    return res.json({ ok: true, briefing: cached.briefing, cached: true });
  }

  try {
    const sections = [];
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    // 1. Daily tasks
    try {
      const todoResult = await executeTool('get_daily_todo', { limit: 5 });
      if (todoResult?.tasks?.length > 0) {
        const highPriority = todoResult.tasks.filter(t => t.score >= 0.6).length;
        sections.push(`📋 <strong>${todoResult.task_count} tasks today</strong>${highPriority ? ` (${highPriority} high priority)` : ''}`);
      }
    } catch { /* non-fatal */ }

    // 2. Environment status
    try {
      const envData = await farmStore.get(farmId, 'telemetry');
      if (envData?.zones?.length > 0) {
        const temps = envData.zones
          .map(z => z.sensors?.tempC?.current ?? z.sensors?.temperature?.current)
          .filter(t => t != null);
        if (temps.length > 0) {
          const avg = (temps.reduce((s, t) => s + t, 0) / temps.length).toFixed(1);
          sections.push(`🌡️ All zones averaging ${avg}°C`);
        }
      }
    } catch { /* non-fatal */ }

    // 3. Active alerts
    try {
      const alertResult = await executeTool('get_alerts', {});
      if (alertResult?.ok && alertResult.count > 0) {
        const critical = alertResult.alerts.filter(a => (a.severity || a.level) === 'critical').length;
        sections.push(`⚠️ ${alertResult.count} active alert${alertResult.count > 1 ? 's' : ''}${critical ? ` (${critical} critical)` : ''}`);
      } else {
        sections.push('✅ No active alerts');
      }
    } catch { /* non-fatal */ }

    // 4. Orders due
    try {
      const orderResult = await executeTool('get_orders', {});
      if (orderResult?.ok && orderResult.orders?.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const dueSoon = orderResult.orders.filter(o => {
          const due = o.delivery_date || o.due_date;
          if (!due) return false;
          const daysUntil = Math.round((new Date(due) - new Date(today)) / 86400000);
          return daysUntil >= 0 && daysUntil <= 1;
        });
        if (dueSoon.length > 0) {
          sections.push(`📦 ${dueSoon.length} order${dueSoon.length > 1 ? 's' : ''} due for delivery today`);
        }
      }
    } catch { /* non-fatal */ }

    // 5. Market highlights
    try {
      if (isDatabaseAvailable()) {
        const mktResult = await query(
          `SELECT product, trend, trend_percent FROM market_price_trends WHERE ABS(trend_percent) > 5 ORDER BY ABS(trend_percent) DESC LIMIT 2`
        );
        if (mktResult.rows.length > 0) {
          const highlights = mktResult.rows.map(r =>
            `${r.product} ${r.trend === 'increasing' ? '↑' : '↓'} ${Math.abs(r.trend_percent)}%`
          ).join(', ');
          sections.push(`💰 Market movers: ${highlights}`);
        }
      }
    } catch { /* non-fatal */ }

    // 6. AI Pusher recommendations
    try {
      const aiRecsResult = await executeTool('get_ai_recommendations', {});
      if (aiRecsResult?.ok && aiRecsResult.count > 0) {
        sections.push(`🤖 ${aiRecsResult.count} AI recommendation${aiRecsResult.count > 1 ? 's' : ''} from network intelligence`);
      }
    } catch { /* non-fatal */ }

    const briefing = `<strong>${greeting}!</strong> Here's your daily briefing:<br><br>` +
      sections.map(s => `${s}`).join('<br>') +
      `<br><br>Say <em>"show tasks"</em> for the full list, or ask me anything.`;

    briefingCache.set(cacheKey, { briefing, created: Date.now() });

    return res.json({ ok: true, briefing, cached: false });
  } catch (err) {
    logger.error('[Morning Briefing] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to generate briefing' });
  }
});

// ── Contextual Nudge Endpoint ─────────────────────────────────────────

/**
 * GET /api/assistant/nudges?farm_id=...
 * Returns rule-based contextual nudges (no LLM call).
 * Light polling endpoint — frontend calls every 5 min.
 */
router.get('/nudges', async (req, res) => {
  const farmId = req.query.farm_id || req.session?.farm_id || 'demo-farm';
  const nudges = [];

  try {
    // 1. Market price increase > 10%
    if (isDatabaseAvailable()) {
      try {
        const result = await query(
          `SELECT product, trend_percent FROM market_price_trends WHERE trend = 'increasing' AND trend_percent > 10 ORDER BY trend_percent DESC LIMIT 3`
        );
        for (const row of result.rows) {
          nudges.push({
            type: 'market_price',
            priority: 'medium',
            message: `${row.product} market prices are up ${row.trend_percent}% this week. Want me to update your pricing?`,
            action: `Update ${row.product} pricing`
          });
        }
      } catch { /* ok */ }
    }

    // 2. Orders due within 4 hours
    try {
      const orderResult = await executeTool('get_orders', {});
      if (orderResult?.ok) {
        const now = Date.now();
        for (const order of (orderResult.orders || [])) {
          const due = order.delivery_date || order.due_date;
          if (!due) continue;
          const hoursUntil = (new Date(due).getTime() - now) / 3600000;
          if (hoursUntil > 0 && hoursUntil <= 4 && order.status !== 'shipped' && order.status !== 'delivered') {
            nudges.push({
              type: 'order_due',
              priority: 'high',
              message: `Order for ${order.buyer_name || order.buyer || order.order_id} is due in ${Math.round(hoursUntil)}h. Status: ${order.status}. Want to see details?`,
              action: 'Show order details'
            });
          }
        }
      }
    } catch { /* ok */ }

    // 3. Crops ready to harvest (from daily todo)
    try {
      const todoResult = await executeTool('get_daily_todo', { category: 'harvest' });
      if (todoResult?.tasks?.length > 0) {
        const ready = todoResult.tasks.filter(t => t.title?.includes('Ready to harvest'));
        for (const task of ready.slice(0, 2)) {
          nudges.push({
            type: 'harvest_ready',
            priority: 'medium',
            message: `${task.title}. Want me to log a harvest?`,
            action: 'Log harvest'
          });
        }
      }
    } catch { /* ok */ }

    // 4. AI Pusher recommendations
    try {
      const aiResult = await executeTool('get_ai_recommendations', { limit: '1' });
      if (aiResult?.ok && aiResult.recommendations?.length > 0) {
        const rec = aiResult.recommendations[0];
        nudges.push({
          type: 'ai_recommendation',
          priority: rec.priority || 'medium',
          message: rec.message || rec.recommendation || rec.title || 'New AI recommendation available.',
          action: 'Show AI recommendations'
        });
      }
    } catch { /* ok */ }

    return res.json({ ok: true, nudges, count: nudges.length });
  } catch (err) {
    logger.error('[Nudges] Error:', err.message);
    return res.json({ ok: true, nudges: [], count: 0 });
  }
});

export default router;
