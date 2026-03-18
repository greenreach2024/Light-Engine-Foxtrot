/**
 * Text-to-Speech route — streams OpenAI TTS audio to the client.
 * POST /api/tts  { text, voice? }
 * Returns audio/mpeg stream.
 *
 * No auth required — rate-limited per IP to prevent abuse.
 */

import { Router } from 'express';
import OpenAI from 'openai';

const router = Router();

let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (e) {
  console.warn('[TTS] Failed to initialise OpenAI client:', e.message);
}

const ALLOWED_VOICES = new Set(['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']);
const MAX_TEXT_LENGTH = 2000;

// Simple per-IP rate limiter: max 20 requests per minute
const _hits = new Map();
const RATE_WINDOW = 60_000;
const RATE_MAX = 20;
setInterval(() => _hits.clear(), RATE_WINDOW);

router.post('/', async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const count = (_hits.get(ip) || 0) + 1;
  _hits.set(ip, count);
  if (count > RATE_MAX) {
    return res.status(429).json({ error: 'Too many TTS requests — try again shortly' });
  }
  if (!openai) {
    return res.status(503).json({ error: 'TTS not available — OPENAI_API_KEY not configured' });
  }

  const { text, voice = 'nova' } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({ error: `text must be ${MAX_TEXT_LENGTH} characters or fewer` });
  }

  const selectedVoice = ALLOWED_VOICES.has(voice) ? voice : 'nova';

  try {
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice: selectedVoice,
      input: text.trim(),
      response_format: 'mp3',
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');

    // OpenAI SDK v6 returns a Response with arrayBuffer(), not a Node stream
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error('[TTS] OpenAI error:', err.message);
    if (err.status === 429) {
      return res.status(429).json({ error: 'Rate limited — try again shortly' });
    }
    return res.status(502).json({ error: 'TTS generation failed' });
  }
});

export default router;
