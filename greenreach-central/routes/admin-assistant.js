/**
 * F.A.Y.E. — Farm Autonomy & Yield Engine
 * =========================================
 * Admin-facing AI assistant for GreenReach Central operations.
 *
 * POST /chat          — Request/response chat with tool-calling loop
 * POST /chat/stream   — SSE streaming chat
 * GET  /briefing      — Operations briefing (morning report)
 * GET  /status        — Service health check
 * GET  /memory        — Get admin memory
 * POST /memory        — Save admin memory
 *
 * Primary LLM: Claude Sonnet 4 (Anthropic)
 * Fallback:    GPT-4o (OpenAI)
 */

import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, isDatabaseAvailable } from '../config/database.js';
import { trackAiUsage, estimateChatCost } from '../lib/ai-usage-tracker.js';
import { ADMIN_TOOL_CATALOG, buildToolDefinitions, executeAdminTool, getTrustTier } from './admin-ops-agent.js';
import { listNetworkFarms } from '../services/networkFarmsStore.js';
import { listAllOrders, listAllBuyers } from '../services/wholesaleMemoryStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

// ── Load Guardrails ────────────────────────────────────────────────
let RULES = { identity: {}, rules: [] };
try {
  const rulesPath = path.join(__dirname, '..', 'data', 'admin-ai-rules.json');
  if (fs.existsSync(rulesPath)) {
    RULES = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  }
} catch (err) {
  console.warn('[F.A.Y.E.] Failed to load admin-ai-rules.json:', err.message);
}

// ── LLM Clients (lazy-init) ───────────────────────────────────────
let anthropicClient = null;
let openaiClient = null;

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const OPENAI_MODEL = 'gpt-4o';
const MAX_TOOL_LOOPS = 10;
const MAX_TOKENS = 2048;

async function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

async function getOpenAIClient() {
  if (openaiClient) return openaiClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const OpenAI = (await import('openai')).default;
  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

// ── Conversation Memory (in-memory + DB) ──────────────────────────
const conversations = new Map();
const pendingActions = new Map(); // convId → { tool, params, description, created_at }
const CONVERSATION_TTL_MS = 60 * 60 * 1000; // 1h for admin sessions
const MAX_HISTORY = 40;

// ── Decision Logging ───────────────────────────────────────────────
async function logDecision(toolName, params, result) {
  if (!isDatabaseAvailable()) return;
  try {
    await query(
      `INSERT INTO faye_decision_log (tool_name, params, result_ok, result_summary, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [toolName, JSON.stringify(params), result?.ok !== false, JSON.stringify(result).slice(0, 1000)]
    );
  } catch { /* best-effort */ }
}

// ── Confirmation Pattern Detection ─────────────────────────────────
const CONFIRM_PATTERNS = /^(yes|confirm|do it|go ahead|proceed|approve|ok|execute|run it|yep|yeah)$/i;

async function getConversation(convId, adminId) {
  const cached = conversations.get(convId);
  if (cached && Date.now() - cached.lastAccess <= CONVERSATION_TTL_MS) {
    cached.lastAccess = Date.now();
    return cached;
  }
  if (cached) conversations.delete(convId);

  try {
    if (isDatabaseAvailable() && adminId) {
      const result = await query(
        `SELECT messages FROM admin_assistant_conversations
         WHERE admin_id = $1 AND conversation_id = $2
         AND updated_at > NOW() - INTERVAL '24 hours'`,
        [adminId, convId]
      );
      if (result.rows.length > 0) {
        const messages = result.rows[0].messages || [];
        const restored = { messages, lastAccess: Date.now() };
        conversations.set(convId, restored);
        return restored;
      }
    }
  } catch { /* DB unavailable — proceed without */ }
  return null;
}

async function upsertConversation(convId, messages, adminId) {
  const trimmed = messages.slice(-MAX_HISTORY);
  conversations.set(convId, { messages: trimmed, lastAccess: Date.now() });

  try {
    if (isDatabaseAvailable() && adminId) {
      await query(
        `INSERT INTO admin_assistant_conversations (admin_id, conversation_id, messages, message_count, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (admin_id, conversation_id)
         DO UPDATE SET messages = $3, message_count = $4, updated_at = NOW()`,
        [adminId, convId, JSON.stringify(trimmed), trimmed.length]
      );
    }
  } catch { /* non-fatal */ }
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [id, conv] of conversations) {
    if (now - conv.lastAccess > CONVERSATION_TTL_MS) conversations.delete(id);
  }
}, 10 * 60 * 1000);

// ── Admin Memory (persistent key-value) ───────────────────────────
async function getAdminMemory(adminId) {
  try {
    if (!isDatabaseAvailable()) return {};
    const result = await query(
      'SELECT key, value FROM admin_assistant_memory WHERE admin_id = $1',
      [adminId]
    );
    return Object.fromEntries(result.rows.map(r => [r.key, r.value]));
  } catch { return {}; }
}

async function setAdminMemory(adminId, key, value) {
  try {
    if (!isDatabaseAvailable()) return false;
    await query(
      `INSERT INTO admin_assistant_memory (admin_id, key, value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (admin_id, key)
       DO UPDATE SET value = $3, updated_at = NOW()`,
      [adminId, key, value]
    );
    return true;
  } catch { return false; }
}

// ── Conversation Summarization ────────────────────────────────────
async function summarizeConversation(messages, adminId) {
  const client = await getAnthropicClient();
  if (!client || messages.length < 6) return null;
  try {
    const text = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-20)
      .map(m => `${m.role}: ${String(m.content || '').slice(0, 300)}`)
      .join('\n');

    const resp = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system: 'Summarize this admin operations conversation into a concise note (max 200 words). Extract: topics, decisions, action items, key metrics. Bullet points.',
      messages: [{ role: 'user', content: text }]
    });

    const summary = resp.content[0]?.text;
    if (summary && isDatabaseAvailable()) {
      await query(
        `INSERT INTO admin_assistant_summaries (admin_id, summary, message_count, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [adminId, summary.slice(0, 2000), messages.length]
      );
    }
    return summary;
  } catch { return null; }
}

async function getRecentSummaries(adminId, limit = 3) {
  try {
    if (!isDatabaseAvailable()) return [];
    const result = await query(
      'SELECT summary, created_at FROM admin_assistant_summaries WHERE admin_id = $1 ORDER BY created_at DESC LIMIT $2',
      [adminId, limit]
    );
    return result.rows;
  } catch { return []; }
}

// ── Dynamic System Prompt ─────────────────────────────────────────

async function buildSystemPrompt(adminId, adminName, adminRole) {
  const identity = RULES.identity;
  const rulesText = RULES.rules.map(r => `• [${r.id}] ${r.rule}`).join('\n');

  // Gather live context (non-blocking, best-effort)
  let farmCount = 0, orderCount = 0, buyerCount = 0, alertCount = 0;
  let recentSummaries = [];
  let adminMemory = {};

  try {
    const [farms, orders, buyers, summaries, memory, alerts] = await Promise.all([
      listNetworkFarms().catch(() => []),
      listAllOrders({ limit: 1 }).catch(() => ({ total: 0 })),
      Promise.resolve(listAllBuyers()).catch(() => []),
      getRecentSummaries(adminId).catch(() => []),
      getAdminMemory(adminId).catch(() => ({})),
      isDatabaseAvailable()
        ? query('SELECT COUNT(*) AS cnt FROM admin_alerts WHERE resolved = FALSE').catch(() => ({ rows: [{ cnt: 0 }] }))
        : Promise.resolve({ rows: [{ cnt: 0 }] })
    ]);
    farmCount = Array.isArray(farms) ? farms.length : 0;
    orderCount = orders?.total || 0;
    buyerCount = Array.isArray(buyers) ? buyers.length : 0;
    alertCount = Number(alerts.rows[0]?.cnt || 0);
    recentSummaries = summaries;
    adminMemory = memory;
  } catch { /* best-effort */ }

  const memorySection = Object.keys(adminMemory).length > 0
    ? `\n## Admin Memory\n${Object.entries(adminMemory).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
    : '';

  const summarySection = recentSummaries.length > 0
    ? `\n## Recent Conversation Context\n${recentSummaries.map(s => `- ${s.summary}`).join('\n')}`
    : '';

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  return `You are ${identity.name} (${identity.full_name}) — ${identity.role}.
Version: ${identity.version}

## Current Context
- Date: ${dateStr}, ${timeStr}
- Admin: ${adminName || 'Unknown'} (role: ${adminRole || 'admin'})
- Network: ${farmCount} farms, ${buyerCount} wholesale buyers
- Open alerts: ${alertCount}
- Total orders tracked: ${orderCount}

## Operating Rules
${rulesText}

## Capabilities
You have ${Object.keys(ADMIN_TOOL_CATALOG).length} tools available across these domains:
- System Health: heartbeats, sync status, nightly audits, admin alerts
- Accounting: trial balance, revenue, AP, transactions, classifications
- Orders: dashboard, detail, payments, refunds, buyer analytics
- Farm Network: overview, detail, diagnostics
- Market Intelligence: prices, trends, AI analysis
- AI Costs: usage tracking, E.V.I.E. engagement, AWS costs
- Delivery: pipeline, scheduling
- Subscriptions & ESG: billing overview, assessments
- Email: SES connectivity

Always use tools to verify data before answering. Never fabricate numbers.

## Write Tool Safety
Some tools can make changes (refunds, emails, alerts). These have trust tiers:
- **Auto**: Safe writes (acknowledge alerts, save notes) — execute immediately.
- **Quick-Confirm / Confirm**: Describe the action clearly, then tell the admin: "Shall I proceed?" Wait for confirmation.
- **Admin**: Critical actions (refunds) — describe the full impact, amount, and target, then ask the admin to explicitly confirm.
When a write tool requires confirmation, you will receive a "pending_confirmation" result. Explain the action to the admin and wait for them to confirm before it runs.
${memorySection}${summarySection}

## Response Style
- Be direct, professional, and concise
- Lead with the answer, then provide supporting data
- Use tables or bullet points for multi-row data
- Flag anomalies and risks proactively
- When unsure, say so — don't guess`;
}

// ── Claude Tool-Calling Loop ──────────────────────────────────────

function estimateClaudeCost(inputTokens, outputTokens) {
  // Claude Sonnet 4 pricing: $3/M input, $15/M output
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

async function chatWithClaude(systemPrompt, messages, tools, convId) {
  const client = await getAnthropicClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');

  const toolCallResults = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let loopCount = 0;
  let hasPendingAction = false;

  // Initial call
  let response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
    tools,
    temperature: 0.7
  });

  totalInputTokens += response.usage?.input_tokens || 0;
  totalOutputTokens += response.usage?.output_tokens || 0;

  // Tool-calling loop
  while (response.stop_reason === 'tool_use' && loopCount < MAX_TOOL_LOOPS) {
    loopCount++;

    // Extract tool_use blocks from response
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      const { id, name, input } = block;
      console.log(`[F.A.Y.E.] Tool call #${loopCount}: ${name}(${JSON.stringify(input)})`);

      const tier = getTrustTier(name);
      let result;

      if (tier !== 'auto') {
        // Store as pending action — requires admin confirmation
        pendingActions.set(convId, {
          tool: name, params: input || {}, tier,
          description: ADMIN_TOOL_CATALOG[name]?.description || name,
          created_at: Date.now()
        });
        result = {
          ok: false, status: 'pending_confirmation', tier,
          message: `Action "${name}" requires ${tier === 'admin' ? 'explicit admin' : ''} confirmation before execution. Describe the action to the admin and ask them to confirm.`
        };
        hasPendingAction = true;
      } else {
        try {
          result = await executeAdminTool(name, input || {});
          // Log write tool executions
          if (ADMIN_TOOL_CATALOG[name]?.category === 'write') {
            logDecision(name, input, result).catch(() => {});
          }
        } catch (err) {
          result = { ok: false, error: err.message };
        }
      }

      toolCallResults.push({ tool: name, params: input, success: result?.ok !== false, tier });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: id,
        content: JSON.stringify(result)
      });
    }

    // Append assistant response + tool results to messages
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    // If a pending action was stored, let the LLM produce its confirmation message then stop
    if (hasPendingAction && loopCount >= 2) break;

    // Follow-up call (lower temperature for deterministic tool follow-ups)
    response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages,
      tools,
      temperature: 0.4
    });

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;
  }

  // Extract final text
  const textBlocks = response.content.filter(b => b.type === 'text');
  const replyText = textBlocks.map(b => b.text).join('\n') || 'Request processed.';

  return {
    reply: replyText,
    toolCalls: toolCallResults,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost: estimateClaudeCost(totalInputTokens, totalOutputTokens)
    },
    model: CLAUDE_MODEL,
    provider: 'anthropic',
    loop_count: loopCount,
    pending_action: hasPendingAction ? pendingActions.get(convId) : null
  };
}

// ── OpenAI Fallback ───────────────────────────────────────────────

function anthropicToolsToOpenAI(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema
    }
  }));
}

async function chatWithOpenAI(systemPrompt, userMessages, tools) {
  const client = await getOpenAIClient();
  if (!client) throw new Error('OPENAI_API_KEY not configured');

  const openaiTools = anthropicToolsToOpenAI(tools);
  const toolCallResults = [];
  let loopCount = 0;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...userMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }))
  ];

  let completion = await client.chat.completions.create({
    model: OPENAI_MODEL,
    messages,
    tools: openaiTools,
    tool_choice: 'auto',
    temperature: 0.7,
    max_tokens: MAX_TOKENS
  });

  let assistantMessage = completion.choices[0].message;

  while (assistantMessage.tool_calls?.length > 0 && loopCount < MAX_TOOL_LOOPS) {
    loopCount++;
    messages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const fnName = toolCall.function.name;
      let fnArgs = {};
      try { fnArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch { /* empty */ }

      console.log(`[F.A.Y.E. OpenAI fallback] Tool call #${loopCount}: ${fnName}`);
      let result;
      try { result = await executeAdminTool(fnName, fnArgs); } catch (err) { result = { ok: false, error: err.message }; }

      toolCallResults.push({ tool: fnName, params: fnArgs, success: result?.ok !== false });
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }

    completion = await client.chat.completions.create({
      model: OPENAI_MODEL, messages, tools: openaiTools, tool_choice: 'auto',
      temperature: 0.4, max_tokens: MAX_TOKENS
    });
    assistantMessage = completion.choices[0].message;
  }

  const replyText = assistantMessage.content || 'Request processed.';
  const usage = completion.usage || {};
  return {
    reply: replyText,
    toolCalls: toolCallResults,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      estimated_cost: estimateChatCost(OPENAI_MODEL, usage.prompt_tokens || 0, usage.completion_tokens || 0)
    },
    model: OPENAI_MODEL,
    provider: 'openai',
    loop_count: loopCount
  };
}

// ── Rate Limiting ─────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(adminId) {
  const now = Date.now();
  let entry = rateLimitMap.get(adminId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitMap.set(adminId, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// ── POST /chat — Standard Request/Response ────────────────────────

router.post('/chat', async (req, res) => {
  const { message, conversation_id } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const adminId = String(req.admin?.id || 'unknown');
  const adminName = req.admin?.name || req.admin?.email || 'Admin';
  const adminRole = req.admin?.role || 'admin';

  if (!checkRateLimit(adminId)) {
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded — please wait a moment.' });
  }

  const sanitized = message.trim().slice(0, 3000);
  const convId = conversation_id || crypto.randomUUID();
  const tools = buildToolDefinitions();

  try {
    // ── Check for pending action confirmation ──
    const pending = pendingActions.get(convId);
    if (pending && CONFIRM_PATTERNS.test(sanitized.trim())) {
      pendingActions.delete(convId);
      // Pending action confirmed — execute it now
      let actionResult;
      try {
        actionResult = await executeAdminTool(pending.tool, pending.params);
        logDecision(pending.tool, pending.params, actionResult).catch(() => {});
      } catch (err) {
        actionResult = { ok: false, error: err.message };
      }

      // Have Claude summarize the result
      const existing = await getConversation(convId, adminId);
      const history = existing ? [...existing.messages] : [];
      const systemPrompt = await buildSystemPrompt(adminId, adminName, adminRole);
      const summaryMessages = [
        ...history.filter(m => m.role !== 'system'),
        { role: 'user', content: `The admin confirmed the action "${pending.tool}". Here is the result:\n${JSON.stringify(actionResult)}\n\nSummarize what happened.` }
      ];

      let result;
      try {
        result = await chatWithClaude(systemPrompt, summaryMessages, tools, convId);
      } catch {
        result = { reply: actionResult.ok !== false ? `✅ Action "${pending.tool}" completed successfully.` : `❌ Action "${pending.tool}" failed: ${actionResult.error}`,
          toolCalls: [{ tool: pending.tool, params: pending.params, success: actionResult.ok !== false }],
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 },
          model: 'none', provider: 'none' };
      }

      const updatedHistory = [...history, { role: 'user', content: sanitized }, { role: 'assistant', content: result.reply }];
      await upsertConversation(convId, updatedHistory, adminId);

      return res.json({
        ok: true, reply: result.reply, conversation_id: convId,
        action_executed: { tool: pending.tool, success: actionResult.ok !== false },
        tool_calls: result.toolCalls?.length > 0 ? result.toolCalls : undefined,
        model: result.model, provider: result.provider
      });
    }

    // ── Check for pending action cancellation ──
    if (pending && /^(no|cancel|stop|nevermind|abort|don't|nope|nah)$/i.test(sanitized.trim())) {
      pendingActions.delete(convId);
      const existing = await getConversation(convId, adminId);
      const history = existing ? [...existing.messages] : [];
      const updatedHistory = [...history, { role: 'user', content: sanitized }, { role: 'assistant', content: `Understood — cancelled the pending "${pending.tool}" action.` }];
      await upsertConversation(convId, updatedHistory, adminId);
      return res.json({ ok: true, reply: `Understood — cancelled the pending "${pending.tool}" action.`, conversation_id: convId, action_cancelled: true });
    }

    // Load conversation history
    const existing = await getConversation(convId, adminId);
    const history = existing ? [...existing.messages] : [];
    const systemPrompt = await buildSystemPrompt(adminId, adminName, adminRole);

    // Build messages for the LLM (Anthropic format: no system in messages)
    const llmMessages = [
      ...history.filter(m => m.role !== 'system'),
      { role: 'user', content: sanitized }
    ];

    let result;
    try {
      result = await chatWithClaude(systemPrompt, llmMessages, tools, convId);
    } catch (claudeErr) {
      console.warn('[F.A.Y.E.] Claude unavailable, falling back to OpenAI:', claudeErr.message);
      try {
        result = await chatWithOpenAI(systemPrompt, llmMessages, tools);
      } catch (openaiErr) {
        console.error('[F.A.Y.E.] Both LLMs unavailable:', openaiErr.message);
        return res.status(503).json({ ok: false, error: 'AI service unavailable — neither Claude nor GPT-4o responded.' });
      }
    }

    // Track cost
    trackAiUsage({
      farm_id: 'greenreach-central',
      endpoint: 'admin-assistant',
      model: result.model,
      prompt_tokens: result.usage.input_tokens,
      completion_tokens: result.usage.output_tokens,
      total_tokens: result.usage.total_tokens,
      estimated_cost: result.usage.estimated_cost,
      status: 'success',
      user_id: adminId
    });

    // Save conversation (store user + assistant only)
    const updatedHistory = [
      ...history,
      { role: 'user', content: sanitized },
      { role: 'assistant', content: result.reply }
    ];
    await upsertConversation(convId, updatedHistory, adminId);

    // Summarize long conversations periodically
    if (updatedHistory.length >= 30 && updatedHistory.length % 10 === 0) {
      summarizeConversation(updatedHistory, adminId).catch(() => {});
    }

    return res.json({
      ok: true,
      reply: result.reply,
      conversation_id: convId,
      tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      pending_action: result.pending_action ? { tool: result.pending_action.tool, tier: result.pending_action.tier, description: result.pending_action.description } : undefined,
      model: result.model,
      provider: result.provider
    });

  } catch (err) {
    console.error('[F.A.Y.E.] Chat error:', err.message);
    trackAiUsage({
      farm_id: 'greenreach-central', endpoint: 'admin-assistant',
      model: CLAUDE_MODEL, status: 'error', error_message: err.message, user_id: adminId
    });
    return res.status(500).json({ ok: false, error: 'Internal error processing your message.' });
  }
});

// ── POST /chat/stream — SSE Streaming ─────────────────────────────

router.post('/chat/stream', async (req, res) => {
  const { message, conversation_id } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'Message is required' });
  }

  const adminId = String(req.admin?.id || 'unknown');
  const adminName = req.admin?.name || req.admin?.email || 'Admin';
  const adminRole = req.admin?.role || 'admin';

  if (!checkRateLimit(adminId)) {
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded.' });
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const sanitized = message.trim().slice(0, 3000);
  const convId = conversation_id || crypto.randomUUID();
  const tools = buildToolDefinitions();

  sendEvent('start', { conversation_id: convId });

  try {
    const existing = await getConversation(convId, adminId);
    const history = existing ? [...existing.messages] : [];
    const systemPrompt = await buildSystemPrompt(adminId, adminName, adminRole);

    const llmMessages = [
      ...history.filter(m => m.role !== 'system'),
      { role: 'user', content: sanitized }
    ];

    // Use Claude with streaming via standard tool loop, then stream the final reply
    let result;
    try {
      const client = await getAnthropicClient();
      if (!client) throw new Error('ANTHROPIC_API_KEY not configured');

      // Tool-calling phase (non-streamed for reliability)
      let response = await client.messages.create({
        model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, system: systemPrompt,
        messages: llmMessages, tools, temperature: 0.7
      });

      const toolCallResults = [];
      let totalInput = response.usage?.input_tokens || 0;
      let totalOutput = response.usage?.output_tokens || 0;
      let loopCount = 0;

      while (response.stop_reason === 'tool_use' && loopCount < MAX_TOOL_LOOPS) {
        loopCount++;
        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults = [];

        for (const block of toolUseBlocks) {
          sendEvent('tool_start', { tool: block.name, step: loopCount });

          const tier = getTrustTier(block.name);
          let toolResult;
          if (tier !== 'auto') {
            pendingActions.set(convId, {
              tool: block.name, params: block.input || {}, tier,
              description: ADMIN_TOOL_CATALOG[block.name]?.description || block.name,
              created_at: Date.now()
            });
            toolResult = { ok: false, status: 'pending_confirmation', tier,
              message: `Action "${block.name}" requires confirmation.` };
            sendEvent('pending_action', { tool: block.name, tier });
          } else {
            try { toolResult = await executeAdminTool(block.name, block.input || {}); }
            catch (err) { toolResult = { ok: false, error: err.message }; }
            if (ADMIN_TOOL_CATALOG[block.name]?.category === 'write') {
              logDecision(block.name, block.input, toolResult).catch(() => {});
            }
          }

          toolCallResults.push({ tool: block.name, params: block.input, success: toolResult?.ok !== false, tier });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(toolResult) });
          sendEvent('tool_done', { tool: block.name, success: toolResult?.ok !== false });
        }

        llmMessages.push({ role: 'assistant', content: response.content });
        llmMessages.push({ role: 'user', content: toolResults });

        response = await client.messages.create({
          model: CLAUDE_MODEL, max_tokens: MAX_TOKENS, system: systemPrompt,
          messages: llmMessages, tools, temperature: 0.4
        });
        totalInput += response.usage?.input_tokens || 0;
        totalOutput += response.usage?.output_tokens || 0;
      }

      // Stream the final text reply in chunks
      const textBlocks = response.content.filter(b => b.type === 'text');
      const fullReply = textBlocks.map(b => b.text).join('\n') || 'Request processed.';
      const chunkSize = 12;
      for (let i = 0; i < fullReply.length; i += chunkSize) {
        sendEvent('token', { text: fullReply.slice(i, i + chunkSize) });
      }

      result = {
        reply: fullReply, toolCalls: toolCallResults,
        usage: { input_tokens: totalInput, output_tokens: totalOutput, total_tokens: totalInput + totalOutput,
          estimated_cost: estimateClaudeCost(totalInput, totalOutput) },
        model: CLAUDE_MODEL, provider: 'anthropic'
      };

    } catch (claudeErr) {
      console.warn('[F.A.Y.E. Stream] Claude unavailable, using OpenAI fallback:', claudeErr.message);
      sendEvent('fallback', { provider: 'openai', reason: claudeErr.message });
      result = await chatWithOpenAI(systemPrompt, llmMessages, tools);

      // Stream the OpenAI reply in chunks
      const chunkSize = 12;
      for (let i = 0; i < result.reply.length; i += chunkSize) {
        sendEvent('token', { text: result.reply.slice(i, i + chunkSize) });
      }
    }

    // Track cost
    trackAiUsage({
      farm_id: 'greenreach-central', endpoint: 'admin-assistant-stream',
      model: result.model, prompt_tokens: result.usage.input_tokens,
      completion_tokens: result.usage.output_tokens, total_tokens: result.usage.total_tokens,
      estimated_cost: result.usage.estimated_cost, status: 'success', user_id: adminId
    });

    // Save conversation
    const updatedHistory = [
      ...history,
      { role: 'user', content: sanitized },
      { role: 'assistant', content: result.reply }
    ];
    await upsertConversation(convId, updatedHistory, adminId);

    sendEvent('done', {
      conversation_id: convId,
      tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      model: result.model, provider: result.provider
    });

  } catch (err) {
    console.error('[F.A.Y.E. Stream] Error:', err.message);
    sendEvent('error', { error: 'Internal error processing your message.' });
  }

  res.end();
});

// ── GET /briefing — Operations Briefing ───────────────────────────

router.get('/briefing', async (req, res) => {
  const adminId = String(req.admin?.id || 'unknown');
  const adminName = req.admin?.name || 'Admin';

  try {
    // Gather key operational data in parallel
    const [
      healthResult,
      heartbeatResult,
      alertResult,
      trialBalanceResult,
      orderResult,
      networkResult,
      aiCostResult
    ] = await Promise.all([
      executeAdminTool('get_system_health', {}),
      executeAdminTool('get_farm_heartbeats', { stale_only: true }),
      executeAdminTool('get_admin_alerts', { limit: 5 }),
      executeAdminTool('get_trial_balance', {}),
      executeAdminTool('get_order_dashboard', { limit: 5 }),
      executeAdminTool('get_network_overview', {}),
      executeAdminTool('get_ai_usage_costs', { days: 1 })
    ]);

    const briefingData = {
      system_health: healthResult,
      stale_farms: heartbeatResult,
      open_alerts: alertResult,
      trial_balance: trialBalanceResult,
      orders: orderResult,
      network: networkResult,
      ai_costs_today: aiCostResult
    };

    // Have Claude synthesize into a briefing
    let briefingText;
    try {
      const client = await getAnthropicClient();
      if (!client) throw new Error('No Claude');

      const resp = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        system: `You are F.A.Y.E. (Farm Autonomy & Yield Engine). Generate a concise operations briefing for ${adminName}. Use the data below. Structure: 1) Status Summary (1-2 sentences), 2) Action Items (numbered, prioritized), 3) Key Metrics. Flag any anomalies. Be direct and professional.`,
        messages: [{ role: 'user', content: `Today's operational data:\n${JSON.stringify(briefingData, null, 2)}` }]
      });

      briefingText = resp.content[0]?.text || 'Briefing data available but synthesis failed.';

      trackAiUsage({
        farm_id: 'greenreach-central', endpoint: 'admin-briefing', model: CLAUDE_MODEL,
        prompt_tokens: resp.usage?.input_tokens, completion_tokens: resp.usage?.output_tokens,
        total_tokens: (resp.usage?.input_tokens || 0) + (resp.usage?.output_tokens || 0),
        estimated_cost: estimateClaudeCost(resp.usage?.input_tokens || 0, resp.usage?.output_tokens || 0),
        status: 'success', user_id: adminId
      });
    } catch {
      // Fallback: return raw data without synthesis
      briefingText = null;
    }

    return res.json({
      ok: true,
      briefing: briefingText,
      raw_data: briefingData,
      generated_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('[F.A.Y.E. Briefing] Error:', err.message);
    return res.status(500).json({ ok: false, error: 'Failed to generate briefing.' });
  }
});

// ── GET /status — Service Health ──────────────────────────────────

router.get('/status', async (_req, res) => {
  let claudeAvailable = false;
  let openaiAvailable = false;

  try { claudeAvailable = !!(await getAnthropicClient()); } catch { /* */ }
  try { openaiAvailable = !!(await getOpenAIClient()); } catch { /* */ }

  return res.json({
    ok: true,
    service: 'F.A.Y.E.',
    version: RULES.identity.version || '1.0.0',
    llm: {
      primary: { provider: 'anthropic', model: CLAUDE_MODEL, available: claudeAvailable },
      fallback: { provider: 'openai', model: OPENAI_MODEL, available: openaiAvailable }
    },
    database: isDatabaseAvailable(),
    tool_count: Object.keys(ADMIN_TOOL_CATALOG).length,
    active_conversations: conversations.size
  });
});

// ── GET /memory — Get admin memory ────────────────────────────────

router.get('/memory', async (req, res) => {
  const adminId = String(req.admin?.id || 'unknown');
  const memory = await getAdminMemory(adminId);
  return res.json({ ok: true, memory });
});

// ── POST /memory — Save admin memory ──────────────────────────────

router.post('/memory', async (req, res) => {
  const { key, value } = req.body;
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ ok: false, error: 'Key is required' });
  }
  const adminId = String(req.admin?.id || 'unknown');
  const saved = await setAdminMemory(adminId, key.trim().slice(0, 100), String(value || '').slice(0, 2000));
  return res.json({ ok: saved });
});

export default router;
