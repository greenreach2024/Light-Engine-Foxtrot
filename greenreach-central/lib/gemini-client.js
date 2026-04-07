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
let _initError = null;

/**
 * Get a shared OpenAI-compatible client pointed at Vertex AI.
 * On Cloud Run this authenticates via ADC (no API key needed).
 * Locally, falls back to GEMINI_API_KEY for the Gemini Developer API.
 */
export async function getGeminiClient() {
  if (_client) return _client;
  if (_initError) throw _initError;

  try {
    // Path 1: Vertex AI on GCP (production — uses ADC)
    if (GCP_PROJECT) {
      const { GoogleAuth } = await import('google-auth-library');
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const authClient = await auth.getClient();
      const token = await authClient.getAccessToken();

      _client = new OpenAI({
        baseURL: `https://${GCP_REGION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT}/locations/${GCP_REGION}/endpoints/openapi`,
        apiKey: token.token || token,
        defaultHeaders: { 'Content-Type': 'application/json' },
      });

      // Refresh token periodically (tokens expire after ~1 hour)
      setInterval(async () => {
        try {
          const freshToken = await authClient.getAccessToken();
          _client.apiKey = freshToken.token || freshToken;
        } catch (err) {
          console.warn('[Gemini] Token refresh failed:', err.message);
        }
      }, 45 * 60 * 1000); // Refresh every 45 minutes

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
    _initError = err;
    console.error('[Gemini] Failed to initialize client:', err.message);
    throw err;
  }
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
