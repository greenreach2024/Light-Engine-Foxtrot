/**
 * AI Usage Tracker — logs every OpenAI API call to the ai_usage table.
 * Provides per-farm cost attribution for chat completions, TTS, and vision.
 *
 * Usage:
 *   import { trackAiUsage } from '../lib/ai-usage-tracker.js';
 *   await trackAiUsage({ farm_id, endpoint, model, prompt_tokens, completion_tokens, ... });
 */

let _query = null;
let _isDatabaseAvailable = null;

async function ensureDb() {
  if (!_query) {
    const db = await import('../config/database.js');
    _query = db.query;
    _isDatabaseAvailable = db.isDatabaseAvailable;
  }
}

/**
 * Record an AI API call to the ai_usage table.
 * Fire-and-forget — errors are logged but never thrown to callers.
 *
 * @param {object} opts
 * @param {string} opts.farm_id          - Farm making the request (nullable for unauthenticated)
 * @param {string} opts.endpoint         - Logical endpoint: 'chat', 'tts', 'vision', 'insights', 'grant-wizard', 'recommendations-pusher'
 * @param {string} opts.model            - OpenAI model used (e.g. 'gpt-4', 'tts-1-hd')
 * @param {number} [opts.prompt_tokens]  - Prompt/input tokens (chat completions)
 * @param {number} [opts.completion_tokens] - Completion/output tokens (chat completions)
 * @param {number} [opts.total_tokens]   - Total tokens (prompt + completion)
 * @param {number} [opts.audio_chars]    - Character count for TTS requests
 * @param {number} [opts.estimated_cost] - Estimated USD cost for the call
 * @param {string} [opts.status]         - 'success' | 'error'
 * @param {string} [opts.error_message]  - Error message if status is 'error'
 * @param {string} [opts.user_id]        - User who triggered the call (nullable)
 */
export async function trackAiUsage(opts) {
  try {
    await ensureDb();
    if (!_isDatabaseAvailable || !(await _isDatabaseAvailable())) return;

    const {
      farm_id = null,
      endpoint = 'unknown',
      model = 'unknown',
      prompt_tokens = null,
      completion_tokens = null,
      total_tokens = null,
      audio_chars = null,
      estimated_cost = null,
      status = 'success',
      error_message = null,
      user_id = null,
    } = opts;

    await _query(
      `INSERT INTO ai_usage
         (farm_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens,
          audio_chars, estimated_cost, status, error_message, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [farm_id, endpoint, model, prompt_tokens, completion_tokens, total_tokens,
       audio_chars, estimated_cost, status, error_message, user_id]
    );
  } catch (err) {
    console.warn('[ai-usage-tracker] Failed to record AI usage:', err.message);
  }
}

/**
 * Estimate cost for a chat completion based on model and token counts.
 * Pricing approximate as of 2025-Q1.
 */
export function estimateChatCost(model, promptTokens, completionTokens) {
  const rates = {
    'gpt-4':            { input: 0.03,    output: 0.06 },
    'gpt-4-turbo':      { input: 0.01,    output: 0.03 },
    'gpt-4o':           { input: 0.0025,  output: 0.01 },
    'gpt-4o-mini':      { input: 0.00015, output: 0.0006 },
  };
  const r = rates[model] || rates['gpt-4o-mini'];
  return (promptTokens / 1000) * r.input + (completionTokens / 1000) * r.output;
}

/**
 * Estimate cost for a TTS call based on character count.
 * tts-1: $15 / 1M chars,  tts-1-hd: $30 / 1M chars
 */
export function estimateTtsCost(model, charCount) {
  const perChar = model === 'tts-1' ? 0.000015 : 0.00003;
  return charCount * perChar;
}
