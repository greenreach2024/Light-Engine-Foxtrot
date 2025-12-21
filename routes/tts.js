const express = require('express');
const router = express.Router();
const https = require('https');

// ElevenLabs API configuration
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'sk_61696248cccecdb79127383ae154886007fe49942d4d0bf7';

// Voice IDs for child-friendly voices
const VOICES = {
  'rachel': '21m00Tcm4TlvDq8ikWAM', // Young, friendly female
  'bella': 'EXAVITQu4vr4xnSDxMaL', // Soft, warm female
  'elli': 'MF3mGyEYCl7XYWbV9V6O', // Energetic, young female
  'sarah': 'EXAVITQu4vr4xnSDxMaL', // Default friendly voice
};

/**
 * POST /api/tts/elevenlabs
 * Generate speech from text using ElevenLabs API
 */
router.post('/elevenlabs', async (req, res) => {
  try {
    const { text, voice = 'rachel' } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Limit text length to prevent abuse (ElevenLabs charges per character)
    if (text.length > 1000) {
      return res.status(400).json({ error: 'Text too long (max 1000 characters)' });
    }

    const voiceId = VOICES[voice] || VOICES['rachel'];
    
    console.log('🔊 Generating ElevenLabs TTS:', {
      textLength: text.length,
      voice: voice,
      voiceId: voiceId
    });

    // Call ElevenLabs API
    const audioBuffer = await generateSpeech(text, voiceId);
    
    // Return audio as base64 for easy playback in browser
    const audioBase64 = audioBuffer.toString('base64');
    
    res.json({
      success: true,
      audio: `data:audio/mpeg;base64,${audioBase64}`,
      voice: voice,
      textLength: text.length
    });

  } catch (error) {
    console.error('❌ ElevenLabs TTS error:', error.message);
    res.status(500).json({ 
      error: 'Failed to generate speech',
      message: error.message 
    });
  }
});

/**
 * Generate speech using ElevenLabs API
 */
function generateSpeech(text, voiceId) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      text: text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    });

    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const chunks = [];

    const apiReq = https.request(options, (apiRes) => {
      if (apiRes.statusCode !== 200) {
        let errorData = '';
        apiRes.on('data', chunk => errorData += chunk);
        apiRes.on('end', () => {
          reject(new Error(`ElevenLabs API error: ${apiRes.statusCode} - ${errorData}`));
        });
        return;
      }

      apiRes.on('data', (chunk) => {
        chunks.push(chunk);
      });

      apiRes.on('end', () => {
        const audioBuffer = Buffer.concat(chunks);
        resolve(audioBuffer);
      });
    });

    apiReq.on('error', (error) => {
      reject(error);
    });

    apiReq.write(postData);
    apiReq.end();
  });
}

module.exports = router;
