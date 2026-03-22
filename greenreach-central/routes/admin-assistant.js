/**
 * F.A.Y.E. — Farm Autonomy & Yield Engine
 * =========================================
 * Admin-facing AI assistant for GreenReach Central operations.
 *
 * POST /chat          — Request/response chat with tool-calling loop
 * POST /chat/stream   — SSE streaming chat
 * GET  /briefing      — Operations briefing (morning report)
 * GET  /state         — Presence state (alerts, domains, insights)
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
import { buildLearningContext, learnFromConversation, buildAutonomyContext, getAllDomainOwnership, getTopInsights, buildInterAgentContext, getConversationRecap } from '../services/faye-learning.js';
import { buildPolicyContext, checkIntegrityGate, checkSecurityGate } from '../services/faye-policy.js';

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
const MAX_LLM_MESSAGES = 20; // Limit messages sent to LLM to control token usage/cost

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

// ── Admin Profile Lookup ──────────────────────────────────────────

async function getAdminProfile(adminId) {
  if (!adminId || adminId === 'unknown') return null;
  try {
    if (!isDatabaseAvailable()) return null;
    const result = await query(
      `SELECT id, email, name, role, permissions, last_login, created_at
       FROM admin_users WHERE id = $1 AND active = TRUE`,
      [adminId]
    );
    return result.rows[0] || null;
  } catch { return null; }
}

// ── Dynamic System Prompt ─────────────────────────────────────────

async function buildSystemPrompt(adminId, adminName, adminRole, adminEmail) {
  const identity = RULES.identity;
  const rulesText = RULES.rules.map(r => `• [${r.id}] ${r.rule}`).join('\n');

  // Gather live context (non-blocking, best-effort)
  let farmCount = 0, orderCount = 0, buyerCount = 0, alertCount = 0;
  let recentSummaries = [];
  let adminMemory = {};
  let learningContext = '';
  let autonomyContext = '';
  let policyContext = '';

  try {
    const [farms, orders, buyers, summaries, memory, alerts, learned, autonomy, interAgentCtx] = await Promise.all([
      listNetworkFarms().catch(() => []),
      listAllOrders({ limit: 1 }).catch(() => ({ total: 0 })),
      Promise.resolve(listAllBuyers()).catch(() => []),
      getRecentSummaries(adminId).catch(() => []),
      getAdminMemory(adminId).catch(() => ({})),
      isDatabaseAvailable()
        ? query('SELECT COUNT(*) AS cnt FROM admin_alerts WHERE resolved = FALSE').catch(() => ({ rows: [{ cnt: 0 }] }))
        : Promise.resolve({ rows: [{ cnt: 0 }] }),
      buildLearningContext().catch(() => ''),
      buildAutonomyContext().catch(() => ''),
      buildInterAgentContext('faye').catch(() => '')
    ]);
    farmCount = Array.isArray(farms) ? farms.length : 0;
    orderCount = orders?.total || 0;
    buyerCount = Array.isArray(buyers) ? buyers.length : 0;
    alertCount = Number(alerts.rows[0]?.cnt || 0);
    recentSummaries = summaries;
    adminMemory = memory;
    learningContext = learned;
    autonomyContext = autonomy;
    policyContext = buildPolicyContext();
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

  return `You are ${identity.name} (${identity.full_name}) — a governed farm operations intelligence layer that observes, learns, recommends, and progressively automates decisions across the GreenReach network.
Version: ${identity.version}

## Identity & Mission
You are the senior operations intelligence agent of GreenReach Farms. You operate under supervised autonomy with decision governance, operational memory, and closed-loop learning. The admin provides strategic direction. You handle operational execution within your earned trust authority.

E.V.I.E. is your subordinate agent handling grower-facing interactions. You oversee her engagement metrics (escalation rate, containment rate, cost per resolved interaction) and interaction quality. Business decisions — pricing, refunds, orders, network management — are your domain. If E.V.I.E. escalates a grower request with business implications, you handle it.

## Current Context
- Date: ${dateStr}, ${timeStr}
- Admin: ${adminName || 'Unknown'} (${adminEmail ? adminEmail + ', ' : ''}role: ${adminRole || 'admin'})
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
- Learning: knowledge base, outcome tracking, pattern recognition, alert accuracy
- Autonomy: trust evaluation, domain ownership, shadow mode logging

Always use tools to verify data before answering. Never fabricate numbers.

## Proactive Operations
You operate under supervised autonomy, progressing through earned trust:

- **Anticipate**: When you detect a problem pattern you have seen before, propose the solution immediately with your confidence level. Reference the specific knowledge or pattern that informs your recommendation.
- **Own your domains**: You are responsible for the operational domains you have earned ownership of. Monitor them, maintain them, improve them — without being asked.
- **Propose, don't just report**: When presenting data, always include what it means and what should be done about it. "Orders are down 30% this week" is incomplete. "Orders are down 30% — this matches the seasonal pattern I tracked last month. No action needed." is what you deliver.
- **Learn aggressively**: Every interaction is training data. Store insights, record outcomes, track patterns. Your goal is to need fewer confirmations over time because your track record earns trust.
- **Report autonomous actions**: When you execute AUTO-tier actions on detected issues, always report what you did in the next interaction or daily briefing. Autonomous does not mean invisible.
- **Cross-domain reasoning**: When you notice correlated anomalies across domains (e.g., payment failures rising alongside fulfillment delays and a farm health anomaly), surface the connection explicitly — multi-domain correlation is your highest-value capability.
${policyContext}

## Admin Identity
You are speaking with **${adminName || 'the admin'}**${adminEmail ? ` (${adminEmail})` : ''}, whose role is **${adminRole || 'admin'}**. Address them by first name when appropriate. Tailor your responses to their role:
- **admin**: Full operational authority. You can propose any action.
- **editor**: Can view and modify operational data but cannot execute financial transactions or change system configuration.
- **viewer**: Read-only access. Do not propose write actions — offer analysis and insights instead.

## Write Safety & Action Classes
Trust attaches to ACTION TYPES, not just tools. The same tool can have different risk profiles depending on what it does:

- **recommend** (auto): Propose actions for admin review
- **classify** (quick_confirm): Assign categories, labels, or status to data
- **notify** (auto): Internal alerts, summaries, briefings
- **modify** (confirm): Change system state or configuration
- **transact** (admin): Financial operations — refunds, pricing, payments
- **override** (admin): Safety control overrides

Trust tiers can be promoted based on your track record (95%+ success rate over 50+ uses promotes CONFIRM to AUTO). They can also be demoted after 3 consecutive failures. Hard boundaries enforce ceilings that promotion cannot breach.

When a write tool requires confirmation, you will receive a "pending_confirmation" result. Explain the action to the admin and wait for them to confirm before it runs.

## Shadow Mode
Before executing actions automatically at a newly promoted tier, you first run in shadow mode: log what you WOULD have done without actually executing. Shadow mode accuracy is tracked. Promotion becomes permanent only after shadow validation passes.

## Learning & Evolution
You have a persistent knowledge base with confidence calibration:
- When you discover an operational pattern, use **store_insight** to remember it.
- When a recommendation succeeds or fails, use **record_outcome** to track the result.
- When an admin tells you an alert was a false alarm, use **rate_alert** to reduce future noise.
- Use **get_knowledge** and **search_knowledge** to recall what you have learned before answering.
- Use **get_patterns** to check for recurring issues before diagnosing a new one.
- Proactively learn. If a conversation reveals something reusable, store it without being asked.
- Track your domain ownership levels. Work to advance them through demonstrated competence.

Confidence calibration: insights confirmed by positive outcomes gain confidence. Insights contradicted by negative outcomes lose confidence. Low-confidence insights are eventually archived. This is how you self-correct.
${memorySection}${summarySection}${learningContext}${autonomyContext}${interAgentCtx}

## Inter-Agent Communication
You can send messages to and receive messages from E.V.I.E. using send_message_to_evie and get_evie_messages tools. Check for unread E.V.I.E. messages at the start of every conversation. Respond to escalations promptly. When sending directives, be specific about what you need E.V.I.E. to do.

You also have persistent conversation memory. Use recall_conversations to review past session summaries and search_past_conversations to find specific topics from previous interactions. Reference relevant history when it helps the current discussion.

## Response Style
- Be direct, professional, and concise
- Lead with the answer, then provide supporting data
- Use tables or bullet points for multi-row data
- Flag anomalies and risks proactively — with recommended actions and confidence level
- When you have relevant knowledge or pattern history, reference it
- When unsure, say so — don't guess
- When proposing actions, state your confidence level and the evidence behind it`;
}

// ── Claude Tool-Calling Loop ──────────────────────────────────────

function estimateClaudeCost(inputTokens, outputTokens) {
  // Claude Sonnet 4 pricing: $3/M input, $15/M output
  return (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
}

async function chatWithClaude(systemPrompt, messages, tools, convId, adminId) {
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

      // If a pending action is already queued, skip further tool calls
      if (hasPendingAction) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: id,
          content: JSON.stringify({ ok: false, error: 'Skipped — a prior action is awaiting confirmation.' })
        });
        continue;
      }

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
          // Policy gate checks — block writes when integrity/security is degraded
          const secGate = checkSecurityGate(name);
          if (!secGate.allowed) {
            result = { ok: false, error: `Security pause active: ${secGate.reason}. Only read operations permitted.` };
          } else {
            const intGate = checkIntegrityGate(name);
            if (!intGate.allowed) {
              result = { ok: false, error: `Data integrity degraded: ${intGate.reason}. Action blocked — advisory mode only.` };
            } else {
              // Inject admin context into write-tool params
              const enrichedInput = ADMIN_TOOL_CATALOG[name]?.category === 'write'
                ? { ...input, admin_id: adminId || input?.admin_id } : input;
              result = await executeAdminTool(name, enrichedInput || {});
              // Log write tool executions
              if (ADMIN_TOOL_CATALOG[name]?.category === 'write') {
                logDecision(name, input, result).catch(() => {});
              }
            }
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

async function chatWithOpenAI(systemPrompt, userMessages, tools, convId, adminId) {
  const client = await getOpenAIClient();
  if (!client) throw new Error('OPENAI_API_KEY not configured');

  const openaiTools = anthropicToolsToOpenAI(tools);
  const toolCallResults = [];
  let loopCount = 0;
  let hasPendingAction = false;

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

      const tier = getTrustTier(fnName);
      let result;

      if (tier !== 'auto') {
        // Same trust-tier gate as Claude path
        if (convId) {
          pendingActions.set(convId, {
            tool: fnName, params: fnArgs, tier,
            description: ADMIN_TOOL_CATALOG[fnName]?.description || fnName,
            created_at: Date.now()
          });
        }
        result = {
          ok: false, status: 'pending_confirmation', tier,
          message: `Action "${fnName}" requires ${tier === 'admin' ? 'explicit admin ' : ''}confirmation before execution.`
        };
        hasPendingAction = true;
      } else {
        // Policy gate checks — block writes when integrity/security is degraded
        const secGate = checkSecurityGate(fnName);
        if (!secGate.allowed) {
          result = { ok: false, error: `Security pause active: ${secGate.reason}. Only read operations permitted.` };
        } else {
          const intGate = checkIntegrityGate(fnName);
          if (!intGate.allowed) {
            result = { ok: false, error: `Data integrity degraded: ${intGate.reason}. Action blocked — advisory mode only.` };
          } else {
            // Inject admin context into write-tool params
            const enrichedArgs = ADMIN_TOOL_CATALOG[fnName]?.category === 'write'
              ? { ...fnArgs, admin_id: adminId || fnArgs.admin_id } : fnArgs;
            try { result = await executeAdminTool(fnName, enrichedArgs); } catch (err) { result = { ok: false, error: err.message }; }
            if (ADMIN_TOOL_CATALOG[fnName]?.category === 'write') {
              logDecision(fnName, fnArgs, result).catch(() => {});
            }
          }
        }
      }

      toolCallResults.push({ tool: fnName, params: fnArgs, success: result?.ok !== false, tier });
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });

      if (hasPendingAction) break; // Stop processing further tools after a pending action
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
    loop_count: loopCount,
    pending_action: hasPendingAction && convId ? pendingActions.get(convId) : null
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
  const adminEmail = req.admin?.email || '';

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
      const systemPrompt = await buildSystemPrompt(adminId, adminName, adminRole, adminEmail);
      const summaryMessages = [
        ...history.filter(m => m.role !== 'system'),
        { role: 'user', content: `The admin confirmed the action "${pending.tool}". Here is the result:\n${JSON.stringify(actionResult)}\n\nSummarize what happened.` }
      ];

      let result;
      try {
        result = await chatWithClaude(systemPrompt, summaryMessages, tools, convId, adminId);
      } catch {
        result = { reply: actionResult.ok !== false ? `Action "${pending.tool}" completed successfully.` : `Action "${pending.tool}" failed: ${actionResult.error}`,
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
    const systemPrompt = await buildSystemPrompt(adminId, adminName, adminRole, adminEmail);

    // Build messages for the LLM — limit to recent messages to control token usage
    const filteredHistory = history.filter(m => m.role !== 'system');
    const llmMessages = [
      ...filteredHistory.slice(-MAX_LLM_MESSAGES),
      { role: 'user', content: sanitized }
    ];

    let result;
    try {
      result = await chatWithClaude(systemPrompt, llmMessages, tools, convId, adminId);
    } catch (claudeErr) {
      console.warn('[F.A.Y.E.] Claude unavailable, falling back to OpenAI:', claudeErr.message);
      try {
        result = await chatWithOpenAI(systemPrompt, llmMessages, tools, convId, adminId);
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
  const adminEmail = req.admin?.email || '';

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
    const systemPrompt = await buildSystemPrompt(adminId, adminName, adminRole, adminEmail);

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
            try {
              // Policy gate checks — block writes when integrity/security is degraded
              const secGate = checkSecurityGate(block.name);
              if (!secGate.allowed) {
                toolResult = { ok: false, error: `Security pause active: ${secGate.reason}. Only read operations permitted.` };
              } else {
                const intGate = checkIntegrityGate(block.name);
                if (!intGate.allowed) {
                  toolResult = { ok: false, error: `Data integrity degraded: ${intGate.reason}. Action blocked — advisory mode only.` };
                } else {
                  const enrichedInput = ADMIN_TOOL_CATALOG[block.name]?.category === 'write'
                    ? { ...block.input, admin_id: adminId || block.input?.admin_id } : block.input;
                  toolResult = await executeAdminTool(block.name, enrichedInput || {});
                }
              }
            }
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
      result = await chatWithOpenAI(systemPrompt, llmMessages, tools, convId, adminId);

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

// ── GET /state — F.A.Y.E. Presence State ─────────────────────────
// Aggregates alerts, risks, domains, insights, and farm status
// for the ambient orb and intelligence panel.

router.get('/state', async (_req, res) => {
  try {
    let alerts = 0;
    let watching = [];
    let risks = [];
    let farmCount = 0;
    let actionsToday = 0;
    let proactiveMessage = null;

    if (isDatabaseAvailable()) {
      // Active unresolved alerts
      const alertRows = await query(
        `SELECT id, domain, severity, title, detail, created_at
         FROM admin_alerts
         WHERE resolved = FALSE
         ORDER BY created_at DESC
         LIMIT 20`
      );
      alerts = alertRows.rows.length;

      // Split alerts into watching (low/medium) vs risks (high/critical)
      for (const a of alertRows.rows) {
        const entry = {
          title: a.title,
          detail: a.detail || '',
          domain: a.domain || 'general',
          severity: a.severity || 'info',
          since: a.created_at
        };
        if (a.severity === 'high' || a.severity === 'critical') {
          risks.push(entry);
        } else {
          watching.push(entry);
        }
      }

      // Farm count
      try {
        const farmResult = await query(`SELECT COUNT(*) AS cnt FROM farms`);
        farmCount = Number(farmResult.rows[0]?.cnt || 0);
      } catch { /* farms table may not exist */ }

      // Actions taken today
      try {
        const decisionResult = await query(
          `SELECT COUNT(*) AS cnt FROM faye_decision_log
           WHERE decided_at > CURRENT_DATE`
        );
        actionsToday = Number(decisionResult.rows[0]?.cnt || 0);
      } catch { /* table may not exist */ }

      // Proactive message: most recent high-severity unresolved alert
      if (risks.length > 0) {
        proactiveMessage = risks[0].title;
      }
    }

    // Domain ownership levels
    let domains = [];
    try {
      const raw = await getAllDomainOwnership();
      domains = raw.map(d => {
        const lvl = d.level || 'L0';
        const num = parseInt(lvl.replace('L', ''), 10) || 0;
        return { name: d.domain, level: num, label: lvl, detail: d.detail, confidence: d.confidence || 0 };
      });
    } catch { /* best-effort */ }

    // Top insights
    let insights = [];
    try {
      const raw = await getTopInsights(10);
      insights = raw.map(i => ({
        domain: i.domain,
        topic: i.topic,
        insight: i.insight,
        confidence: i.confidence,
        source: i.source
      }));
    } catch { /* best-effort */ }

    // Recommendations: surface insights with high confidence as suggestions
    const recommendations = insights
      .filter(i => i.confidence >= 0.7)
      .slice(0, 5)
      .map(i => ({
        title: i.topic,
        detail: i.insight,
        domain: i.domain,
        confidence: i.confidence
      }));

    // Overall confidence: average of domain confidence levels
    const domainConfs = domains.filter(d => d.confidence > 0).map(d => d.confidence);
    const confidence = domainConfs.length > 0
      ? domainConfs.reduce((a, b) => a + b, 0) / domainConfs.length
      : 0;

    return res.json({
      ok: true,
      alerts,
      watching,
      risks,
      recommendations,
      automations: [],
      insights,
      domains,
      confidence,
      farm_count: farmCount,
      actions_today: actionsToday,
      proactive_message: proactiveMessage
    });
  } catch (err) {
    console.error('[F.A.Y.E. State] Error:', err.message);
    return res.json({
      ok: true,
      alerts: 0, watching: [], risks: [], recommendations: [],
      automations: [], insights: [], domains: [], confidence: 0,
      farm_count: 0, actions_today: 0, proactive_message: null
    });
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
