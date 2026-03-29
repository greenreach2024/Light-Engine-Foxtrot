#!/usr/bin/env python3
"""Apply LLM fallback to E.V.I.E. and auto-recovery to F.A.Y.E."""
import re

# ──────────────────────────────────────────────────────────────────────
# FIX 1: E.V.I.E. Anthropic LLM Fallback (assistant-chat.js)
# ──────────────────────────────────────────────────────────────────────

EVIE_FILE = 'greenreach-central/routes/assistant-chat.js'
with open(EVIE_FILE, 'r') as f:
    evie = f.read()

# 1A. Insert Anthropic client + utils after MODEL declaration
old_model = "const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';"
new_model = """const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// ── Anthropic Client (LLM Fallback) ───────────────────────────────────
let anthropicClient = null;
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || 'claude-sonnet-4-20250514';

async function getAnthropicClient() {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey });
    return anthropicClient;
  } catch (err) {
    console.error('[E.V.I.E.] Failed to init Anthropic client:', err.message);
    return null;
  }
}

function openaiToolsToAnthropic(tools) {
  return tools.filter(t => t && t.function).map(t => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema: t.function.parameters || { type: 'object', properties: {} }
  }));
}

function estimateAnthropicCost(inputTokens, outputTokens) {
  const isHaiku = FALLBACK_MODEL.includes('haiku');
  const inputRate = isHaiku ? 0.80 : 3;
  const outputRate = isHaiku ? 4 : 15;
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}"""
assert evie.count(old_model) == 1, f"Expected 1 occurrence of MODEL declaration, found {evie.count(old_model)}"
evie = evie.replace(old_model, new_model, 1)
print("[OK] 1A: Inserted Anthropic client + utils after MODEL declaration")

# 1B. Insert chatWithAnthropicFallback function before the rate limiter / /chat handler
old_rate_anchor = "// ── Main Chat Endpoint ────────────────────────────────────────────────"
new_fallback_fn = """// ── Anthropic Fallback Chat Function ──────────────────────────────────

async function chatWithAnthropicFallback(systemPrompt, history, userMessage, farmId, convId) {
  const client = await getAnthropicClient();
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured');

  const anthropicTools = openaiToolsToAnthropic(GPT_TOOLS);
  const toolCallResults = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let loopCount = 0;

  // Convert history to Anthropic message format (user/assistant only)
  const messages = history
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }));
  messages.push({ role: 'user', content: userMessage });

  let response = await client.messages.create({
    model: FALLBACK_MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages,
    tools: anthropicTools,
    temperature: 0.7
  });

  totalInputTokens += response.usage?.input_tokens || 0;
  totalOutputTokens += response.usage?.output_tokens || 0;

  // Tool-calling loop
  while (response.stop_reason === 'tool_use' && loopCount < 10) {
    loopCount++;
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = [];

    for (const block of toolUseBlocks) {
      const { id, name, input } = block;
      console.log(`[E.V.I.E. Anthropic fallback] Tool call #${loopCount}: ${name}`);

      let toolResult;
      try {
        const isWriteTool = TOOL_CATALOG[name]?.category === 'write' || TRUST_TIERS.confirm.has(name) || TRUST_TIERS.admin.has(name);
        const tier = getTrustTier(name);

        if (isWriteTool && tier === 'auto') {
          toolResult = await executeExtendedTool(name, input || {}, farmId);
        } else if (isWriteTool && tier === 'quick_confirm') {
          toolResult = await executeExtendedTool(name, { ...input, confirm: true }, farmId);
        } else if (isWriteTool && (tier === 'confirm' || tier === 'admin')) {
          pendingActions.set(convId, { tool: name, params: input || {}, farmId, created: Date.now() });
          toolResult = {
            status: 'pending_confirmation',
            message: 'This action requires user confirmation before execution.',
            tool: name, params: input
          };
        } else {
          toolResult = await executeExtendedTool(name, input || {}, farmId);
        }
      } catch (err) {
        toolResult = { ok: false, error: err.message };
      }

      // Self-solving: attempt auto-recovery on failure
      if (toolResult && toolResult.ok === false && toolResult.error) {
        const recovery = await attemptAutoRecovery(name, input || {}, toolResult.error, farmId);
        if (recovery.recovered) {
          toolResult = recovery.result;
          logger.info(`[E.V.I.E. Fallback Self-Solve] Auto-recovered ${name}: ${recovery.strategy}`);
        }
      }

      toolCallResults.push({ tool: name, params: input, success: toolResult?.ok !== false });
      toolResults.push({ type: 'tool_result', tool_use_id: id, content: JSON.stringify(toolResult) });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await client.messages.create({
      model: FALLBACK_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages,
      tools: anthropicTools,
      temperature: 0.4
    });

    totalInputTokens += response.usage?.input_tokens || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;
  }

  const textBlocks = response.content.filter(b => b.type === 'text');
  const replyText = textBlocks.map(b => b.text).join('\\n') || 'Request processed.';

  return {
    reply: replyText,
    toolCalls: toolCallResults,
    model: FALLBACK_MODEL,
    provider: 'anthropic',
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      estimated_cost: estimateAnthropicCost(totalInputTokens, totalOutputTokens)
    }
  };
}

// ── Main Chat Endpoint ────────────────────────────────────────────────"""
assert evie.count(old_rate_anchor) == 1, f"Expected 1 rate anchor, found {evie.count(old_rate_anchor)}"
evie = evie.replace(old_rate_anchor, new_fallback_fn, 1)
print("[OK] 1B: Inserted chatWithAnthropicFallback function")

# 1C. Change /chat guard to accept Anthropic as alternative
old_guard = """  if (!openai) {
    return res.status(503).json({
      ok: false,
      error: 'AI assistant not available — OPENAI_API_KEY not configured'
    });
  }

  const { message, conversation_id, farm_id } = req.body;"""
new_guard = """  if (!openai && !process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      ok: false,
      error: 'AI assistant not available — no LLM provider configured'
    });
  }

  const { message, conversation_id, farm_id } = req.body;"""
assert evie.count(old_guard) == 1, f"Expected 1 /chat guard, found {evie.count(old_guard)}"
evie = evie.replace(old_guard, new_guard, 1)
print("[OK] 1C: Updated /chat guard for dual-LLM")

# 1D. Add Anthropic fallback in /chat catch block
old_chat_catch = """  } catch (error) {
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

// ── GET /state"""
new_chat_catch = """  } catch (error) {
    // Attempt Anthropic fallback before giving up
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.warn('[E.V.I.E.] OpenAI failed, attempting Anthropic fallback:', error.message);
        const fbExisting = await getConversation(convId, farmId);
        const fbHistory = fbExisting ? [...fbExisting.messages] : [];
        const fbSystemPrompt = await buildSystemPrompt(farmId);
        const fallbackResult = await chatWithAnthropicFallback(fbSystemPrompt, fbHistory, sanitizedMessage, farmId, convId);

        trackAiUsage({
          farm_id: farmId, endpoint: 'assistant-chat', model: fallbackResult.model,
          prompt_tokens: fallbackResult.usage.input_tokens,
          completion_tokens: fallbackResult.usage.output_tokens,
          total_tokens: fallbackResult.usage.total_tokens,
          estimated_cost: fallbackResult.usage.estimated_cost,
          status: 'success'
        });

        const fbUpdatedHistory = [
          ...fbHistory,
          { role: 'user', content: sanitizedMessage },
          { role: 'assistant', content: fallbackResult.reply }
        ];
        await upsertConversation(convId, fbUpdatedHistory, farmId);

        const fbToolNames = fallbackResult.toolCalls.map(t => t.tool);
        trackEngagement(farmId, { messages: 1, toolCalls: fbToolNames.length, toolsUsed: fbToolNames });

        const fbPendingAction = pendingActions.get(convId);
        return res.json({
          ok: true,
          reply: fallbackResult.reply,
          conversation_id: convId,
          tool_calls: fallbackResult.toolCalls.length > 0 ? fallbackResult.toolCalls : undefined,
          pending_action: fbPendingAction ? { tool: fbPendingAction.tool, params: fbPendingAction.params } : undefined,
          model: fallbackResult.model,
          provider: 'anthropic'
        });
      } catch (fallbackErr) {
        console.error('[E.V.I.E.] Both LLMs failed. OpenAI:', error.message, 'Anthropic:', fallbackErr.message);
      }
    }

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

// ── GET /state"""
assert evie.count(old_chat_catch) == 1, f"Expected 1 /chat catch block, found {evie.count(old_chat_catch)}"
evie = evie.replace(old_chat_catch, new_chat_catch, 1)
print("[OK] 1D: Added Anthropic fallback to /chat catch block")

# 1E. Change /chat/stream guard
old_stream_guard = """router.post('/chat/stream', async (req, res) => {
  if (!openai) {
    return res.status(503).json({ ok: false, error: 'AI assistant not available' });
  }"""
new_stream_guard = """router.post('/chat/stream', async (req, res) => {
  if (!openai && !process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ ok: false, error: 'AI assistant not available — no LLM provider configured' });
  }"""
assert evie.count(old_stream_guard) == 1, f"Expected 1 stream guard, found {evie.count(old_stream_guard)}"
evie = evie.replace(old_stream_guard, new_stream_guard, 1)
print("[OK] 1E: Updated /chat/stream guard for dual-LLM")

# 1F. Add Anthropic fallback in /chat/stream catch block
old_stream_catch = """  } catch (error) {
    console.error('[Stream Chat] Error:', error.message);
    sendEvent('error', { message: 'Failed to process your message.' });
  }

  res.end();
});

// ── Image Upload Endpoint"""
new_stream_catch = """  } catch (error) {
    // Attempt Anthropic fallback before sending error
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.warn('[E.V.I.E. Stream] OpenAI failed, using Anthropic fallback:', error.message);
        sendEvent('fallback', { provider: 'anthropic', reason: error.message });

        const fbExisting = await getConversation(convId, farmId);
        const fbHistory = fbExisting ? [...fbExisting.messages] : [];
        const fbSystemPrompt = await buildSystemPrompt(farmId);
        const fallbackResult = await chatWithAnthropicFallback(fbSystemPrompt, fbHistory, sanitizedMessage, farmId, convId);

        // Emit reply as chunks for streaming feel
        const chunkSize = 12;
        for (let i = 0; i < fallbackResult.reply.length; i += chunkSize) {
          sendEvent('token', { text: fallbackResult.reply.slice(i, i + chunkSize) });
        }

        const fbUpdatedHistory = [
          ...fbHistory,
          { role: 'user', content: sanitizedMessage },
          { role: 'assistant', content: fallbackResult.reply }
        ];
        await upsertConversation(convId, fbUpdatedHistory, farmId);

        const fbToolNames = fallbackResult.toolCalls.map(t => t.tool);
        trackEngagement(farmId, { messages: 1, toolCalls: fbToolNames.length, toolsUsed: fbToolNames });

        trackAiUsage({
          farm_id: farmId, endpoint: 'assistant-chat', model: fallbackResult.model,
          prompt_tokens: fallbackResult.usage.input_tokens,
          completion_tokens: fallbackResult.usage.output_tokens,
          total_tokens: fallbackResult.usage.total_tokens,
          estimated_cost: fallbackResult.usage.estimated_cost,
          status: 'success'
        });

        const fbPendingAction = pendingActions.get(convId);
        sendEvent('done', {
          conversation_id: convId,
          tool_calls: fallbackResult.toolCalls.length > 0 ? fallbackResult.toolCalls : undefined,
          pending_action: fbPendingAction ? { tool: fbPendingAction.tool, params: fbPendingAction.params } : undefined,
          model: fallbackResult.model,
          provider: 'anthropic'
        });
        res.end();
        return;
      } catch (fallbackErr) {
        console.error('[E.V.I.E. Stream] Both LLMs failed. OpenAI:', error.message, 'Anthropic:', fallbackErr.message);
      }
    }

    console.error('[Stream Chat] Error:', error.message);
    sendEvent('error', { message: 'Failed to process your message.' });
  }

  res.end();
});

// ── Image Upload Endpoint"""
assert evie.count(old_stream_catch) == 1, f"Expected 1 stream catch block, found {evie.count(old_stream_catch)}"
evie = evie.replace(old_stream_catch, new_stream_catch, 1)
print("[OK] 1F: Added Anthropic fallback to /chat/stream catch block")

# 1G. Update /status endpoint to report fallback availability
old_status = """router.get('/status', (req, res) => {
  res.json({
    ok: true,
    available: !!openai,
    model: MODEL,
    active_conversations: conversations.size,
    features: {
      streaming: true,
      trust_tiers: true,
      image_input: true,
      voice_first: true,
      workflows: true,
      reports: true,
      multi_farm: true,
      websocket_push: true,
      predictive_alerts: true
    }
  });
});"""
new_status = """router.get('/status', async (req, res) => {
  let fallbackAvailable = false;
  try { fallbackAvailable = !!(await getAnthropicClient()); } catch { /* */ }
  res.json({
    ok: true,
    available: !!openai || fallbackAvailable,
    model: MODEL,
    active_conversations: conversations.size,
    llm: {
      primary: { provider: 'openai', model: MODEL, available: !!openai },
      fallback: { provider: 'anthropic', model: FALLBACK_MODEL, available: fallbackAvailable }
    },
    features: {
      streaming: true,
      trust_tiers: true,
      image_input: true,
      voice_first: true,
      workflows: true,
      reports: true,
      multi_farm: true,
      websocket_push: true,
      predictive_alerts: true
    }
  });
});"""
assert evie.count(old_status) == 1, f"Expected 1 /status endpoint, found {evie.count(old_status)}"
evie = evie.replace(old_status, new_status, 1)
print("[OK] 1G: Updated /status with fallback info")

with open(EVIE_FILE, 'w') as f:
    f.write(evie)
print(f"[DONE] E.V.I.E. fallback written to {EVIE_FILE}")

# ──────────────────────────────────────────────────────────────────────
# FIX 2: F.A.Y.E. Auto-Recovery (admin-assistant.js)
# ──────────────────────────────────────────────────────────────────────

FAYE_FILE = 'greenreach-central/routes/admin-assistant.js'
with open(FAYE_FILE, 'r') as f:
    faye = f.read()

# 2A. Insert attemptAdminAutoRecovery function before chatWithClaude
old_claude_anchor = "function estimateClaudeCost(inputTokens, outputTokens) {"
new_recovery_fn = """// ── Self-Solving Error Recovery ────────────────────────────────────────

async function attemptAdminAutoRecovery(toolName, params, errorMsg) {
  const errLower = (errorMsg || '').toLowerCase();

  // Strategy 1: database unavailable -- retry once after 1s
  if (errLower.includes('database') && errLower.includes('unavailable')) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const result = await executeAdminTool(toolName, params);
      if (result?.ok !== false) return { recovered: true, result, strategy: 'database_retry_success' };
    } catch { /* fall through */ }
    return { recovered: false, strategy: 'database_retry_failed', hint: 'Database is temporarily unavailable. Try again in a few minutes.' };
  }

  // Strategy 2: connection/timeout errors -- retry once after 2s
  if (errLower.includes('econnrefused') || errLower.includes('timeout') || errLower.includes('econnreset')) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const result = await executeAdminTool(toolName, params);
      if (result?.ok !== false) return { recovered: true, result, strategy: 'connection_retry_success' };
    } catch { /* fall through */ }
    return { recovered: false, strategy: 'connection_retry_failed', hint: 'Connection failed after retry. The service may be temporarily down.' };
  }

  // Strategy 3: constraint violation
  if (errLower.includes('foreign key') || errLower.includes('violates') || errLower.includes('constraint')) {
    return { recovered: false, strategy: 'constraint_violation', hint: 'A database constraint was violated. A referenced record likely does not exist.' };
  }

  // No auto-recovery available
  return { recovered: false, strategy: 'no_recovery_available', hint: `Tool "${toolName}" failed: ${errorMsg}` };
}

function estimateClaudeCost(inputTokens, outputTokens) {"""
assert faye.count(old_claude_anchor) == 1, f"Expected 1 estimateClaudeCost, found {faye.count(old_claude_anchor)}"
faye = faye.replace(old_claude_anchor, new_recovery_fn, 1)
print("[OK] 2A: Inserted attemptAdminAutoRecovery function")

# 2B. Add auto-recovery after tool execution in chatWithClaude
# Target: after the catch block for tool execution, before toolCallResults.push
old_claude_tool_result = """        } catch (err) {
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
    messages.push({ role: 'assistant', content: response.content });"""
new_claude_tool_result = """        } catch (err) {
          result = { ok: false, error: err.message };
        }
      }

      // Self-solving: attempt auto-recovery on failure
      if (result?.ok === false && result?.error) {
        const recovery = await attemptAdminAutoRecovery(name, input, result.error);
        if (recovery.recovered) {
          result = recovery.result;
          console.log(`[F.A.Y.E. Self-Solve] Auto-recovered ${name}: ${recovery.strategy}`);
        } else if (recovery.hint) {
          result._self_solve_hint = recovery.hint;
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
    messages.push({ role: 'assistant', content: response.content });"""
assert faye.count(old_claude_tool_result) == 1, f"Expected 1 Claude tool result block, found {faye.count(old_claude_tool_result)}"
faye = faye.replace(old_claude_tool_result, new_claude_tool_result, 1)
print("[OK] 2B: Added auto-recovery to chatWithClaude tool loop")

# 2C. Add auto-recovery after tool execution in chatWithOpenAI (fallback)
old_openai_tool_result = """            try { result = await executeAdminTool(fnName, enrichedArgs); } catch (err) { result = { ok: false, error: err.message }; }
            if (ADMIN_TOOL_CATALOG[fnName]?.category === 'write') {
              logDecision(fnName, fnArgs, result).catch(() => {});
            }
          }
        }
      }

      toolCallResults.push({ tool: fnName, params: fnArgs, success: result?.ok !== false, tier });
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });

      if (hasPendingAction) break; // Stop processing further tools after a pending action"""
new_openai_tool_result = """            try { result = await executeAdminTool(fnName, enrichedArgs); } catch (err) { result = { ok: false, error: err.message }; }
            if (ADMIN_TOOL_CATALOG[fnName]?.category === 'write') {
              logDecision(fnName, fnArgs, result).catch(() => {});
            }
          }
        }
      }

      // Self-solving: attempt auto-recovery on failure
      if (result?.ok === false && result?.error) {
        const recovery = await attemptAdminAutoRecovery(fnName, fnArgs, result.error);
        if (recovery.recovered) {
          result = recovery.result;
          console.log(`[F.A.Y.E. OpenAI Self-Solve] Auto-recovered ${fnName}: ${recovery.strategy}`);
        } else if (recovery.hint) {
          result._self_solve_hint = recovery.hint;
        }
      }

      toolCallResults.push({ tool: fnName, params: fnArgs, success: result?.ok !== false, tier });
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });

      if (hasPendingAction) break; // Stop processing further tools after a pending action"""
assert faye.count(old_openai_tool_result) == 1, f"Expected 1 OpenAI tool result block, found {faye.count(old_openai_tool_result)}"
faye = faye.replace(old_openai_tool_result, new_openai_tool_result, 1)
print("[OK] 2C: Added auto-recovery to chatWithOpenAI tool loop")

with open(FAYE_FILE, 'w') as f:
    f.write(faye)
print(f"[DONE] F.A.Y.E. auto-recovery written to {FAYE_FILE}")

print("\n=== All fixes applied successfully ===")
