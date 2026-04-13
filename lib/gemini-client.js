/**
 * Gemini Client — Shared Vertex AI client for all GreenReach AI agents.
 * ====================================================================
 * Uses the OpenAI SDK pointed at the Vertex AI Chat Completions endpoint.
 * This provides a drop-in replacement for OpenAI calls — same request/response
 * format, same tool-calling schema, same streaming interface.
 *
 * Authentication:
 *   - On Cloud Run: automatic via Application Default Credentials (ADC)
 *   - Locally: set GOOGLE_APPLICATION_CREDENTIALS to a service account key,
 *     or fall back to GEMINI_API_KEY for direct Gemini Developer API access
 *
 * Models:
 *   - GEMINI_FLASH:    gemini-2.5-flash     (EVIE, FAYE, SCOTT — general agents)
 *   - GEMINI_PRO:      gemini-2.5-pro       (GWEN — research, deep reasoning)
 *   - GEMINI_LITE:     gemini-2.5-flash-lite (batch: market analysis, pusher, insights)
 */

import OpenAI from 'openai';

// ── Configuration ─────────────────────────────────────────────────────
const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
const GCP_REGION = process.env.GCP_REGION || 'us-east1';

export const GEMINI_FLASH = 'google/gemini-2.5-flash';
export const GEMINI_PRO = 'google/gemini-2.5-pro';
export const GEMINI_LITE = 'google/gemini-2.5-flash-lite';

// ── Client Singleton ──────────────────────────────────────────────────
let _client = null;
let _authClient = null;
let _initInProgress = null;

/**
 * Force-refresh the ADC token on the existing client.
 * Called automatically on Vertex AI 401 errors.
 */
export async function refreshGeminiToken() {
  if (!_authClient || !_client) return;
  try {
    const freshToken = await _authClient.getAccessToken();
    _client.apiKey = freshToken.token || freshToken;
    console.log('[Gemini] Token refreshed successfully');
  } catch (err) {
    console.error('[Gemini] Token refresh failed:', err.message);
    // Force full re-init on next call
    _client = null;
    _authClient = null;
    _initInProgress = null;
  }
}

/**
 * Get a shared OpenAI-compatible client pointed at Vertex AI.
 * On Cloud Run this authenticates via ADC (no API key needed).
 * Locally, falls back to GEMINI_API_KEY for the Gemini Developer API.
 * Init errors are NOT permanently cached — retries are allowed.
 */
export async function getGeminiClient() {
  if (_client) return _client;
  // Deduplicate concurrent init calls
  if (_initInProgress) return _initInProgress;

  _initInProgress = (async () => {
    try {
      // Path 1: Vertex AI on GCP (production — uses ADC)
      if (GCP_PROJECT) {
        const { GoogleAuth } = await import('google-auth-library');
        const auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
        _authClient = await auth.getClient();
        const token = await _authClient.getAccessToken();

        _client = new OpenAI({
          baseURL: `https://${GCP_REGION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${GCP_REGION}/endpoints/openapi`,
          apiKey: token.token || token,
          defaultHeaders: { 'Content-Type': 'application/json' },
        });

        // Refresh token every 30 minutes (ADC tokens expire after ~60 min)
        setInterval(async () => {
          try {
            const freshToken = await _authClient.getAccessToken();
            _client.apiKey = freshToken.token || freshToken;
          } catch (err) {
            console.warn('[Gemini] Periodic token refresh failed:', err.message);
          }
        }, 30 * 60 * 1000);

        console.log(`[Gemini] Vertex AI client initialized (project: ${GCP_PROJECT}, region: ${GCP_REGION})`);
        return _client;
      }

      // Path 2: Gemini Developer API (local dev / non-GCP)
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        _client = new OpenAI({
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/',
          apiKey,
        });
        console.log('[Gemini] Developer API client initialized (GEMINI_API_KEY)');
        return _client;
      }

      throw new Error('No Gemini credentials available. Set GCP_PROJECT (for Vertex AI ADC) or GEMINI_API_KEY (for Developer API).');
    } catch (err) {
      // Do NOT permanently cache — allow retry on next call
      _client = null;
      _authClient = null;
      console.error('[Gemini] Failed to initialize client:', err.message);
      throw err;
    } finally {
      _initInProgress = null;
    }
  })();

  return _initInProgress;
}

/**
 * Check if Gemini is available (credentials configured).
 */
export function isGeminiConfigured() {
  return !!(GCP_PROJECT || process.env.GEMINI_API_KEY);
}

/**
 * Estimate cost for a Gemini API call.
 * Pricing per 1M tokens as of April 2026.
 */
export function estimateGeminiCost(model, promptTokens, completionTokens) {
  const rates = {
    'google/gemini-2.5-flash':      { input: 0.30,  output: 2.50 },
    'google/gemini-2.5-pro':        { input: 1.25,  output: 10.00 },
    'google/gemini-2.5-flash-lite': { input: 0.10,  output: 0.40 },
    'gemini-2.5-flash':             { input: 0.30,  output: 2.50 },
    'gemini-2.5-pro':               { input: 1.25,  output: 10.00 },
    'gemini-2.5-flash-lite':        { input: 0.10,  output: 0.40 },
  };
  const r = rates[model] || rates['google/gemini-2.5-flash'];
  return (promptTokens / 1_000_000) * r.input + (completionTokens / 1_000_000) * r.output;
}

/**
 * Convert Anthropic-format tool definitions to OpenAI format.
 * FAYE/GWEN/SCOTT define tools in Anthropic format; the Vertex AI
 * Chat Completions API uses OpenAI format.
 */
export function anthropicToolsToOpenAI(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} },
    },
  }));
}

/**
 * Wrapper for chat.completions.create that auto-retries on 401 (expired token).
 * Use this instead of calling client.chat.completions.create() directly.
 */
export async function geminiChatCreate(params) {
  const client = await getGeminiClient();
  try {
    return await client.chat.completions.create(params);
  } catch (err) {
    const status = err?.status || err?.response?.status || (err?.message && err.message.match(/(\d{3}) status/)?.[1]);
    if (String(status) === '401' && GCP_PROJECT) {
      console.warn('[Gemini] 401 from Vertex AI — refreshing token and retrying');
      await refreshGeminiToken();
      const retryClient = await getGeminiClient();
      return await retryClient.chat.completions.create(params);
    }
    throw err;
  }
}
