/**
 * Gemini Client for Light Engine
 * Simplified Vertex AI client using OpenAI SDK.
 * Auth: ADC on Cloud Run, GEMINI_API_KEY locally.
 */

import OpenAI from 'openai';

const GCP_PROJECT = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
const GCP_REGION = process.env.GCP_REGION || 'us-east1';

export const GEMINI_FLASH = 'google/gemini-2.5-flash';
export const GEMINI_LITE = 'google/gemini-2.5-flash-lite';

let _client = null;
let _initError = null;

export async function getGeminiClient() {
  if (_client) return _client;
  if (_initError) throw _initError;

  try {
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

      setInterval(async () => {
        try {
          const freshToken = await authClient.getAccessToken();
          _client.apiKey = freshToken.token || freshToken;
        } catch (err) {
          console.warn('[Gemini-LE] Token refresh failed:', err.message);
        }
      }, 45 * 60 * 1000);

      console.log(`[Gemini-LE] Vertex AI client initialized (project: ${GCP_PROJECT})`);
      return _client;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      _client = new OpenAI({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/',
        apiKey,
      });
      console.log('[Gemini-LE] Developer API client initialized');
      return _client;
    }

    throw new Error('No Gemini credentials. Set GCP_PROJECT or GEMINI_API_KEY.');
  } catch (err) {
    _initError = err;
    console.error('[Gemini-LE] Init failed:', err.message);
    throw err;
  }
}

export function isGeminiConfigured() {
  return !!(GCP_PROJECT || process.env.GEMINI_API_KEY);
}
