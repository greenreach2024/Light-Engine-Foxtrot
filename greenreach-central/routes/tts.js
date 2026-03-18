/**
 * Text-to-Speech route — streams OpenAI TTS audio to the client.
 * POST /api/tts  { text, voice? }
 * Returns audio/mpeg stream.
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

router.post('/', async (req, res) => {
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

    const stream = response.body;
    stream.pipe(res);
  } catch (err) {
    console.error('[TTS] OpenAI error:', err.message);
    if (err.status === 429) {
      return res.status(429).json({ error: 'Rate limited — try again shortly' });
    }
    return res.status(502).json({ error: 'TTS generation failed' });
  }
});

export default router;
