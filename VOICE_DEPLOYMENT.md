# Gemini Live Voice Interaction Deployment Guide

This guide explains how to deploy the Gemini Live voice interaction feature using Cloudflare Workers.

## Overview

The voice interaction feature uses:
- **Gemini 2.5 Flash with Native Audio** (`models/gemini-2.5-flash-native-audio-preview-09-2025`)
- **WebSocket-based bidirectional streaming** for real-time voice communication
- **Native audio processing** (no browser TTS or speech recognition APIs)
- **Cloudflare Workers** to securely handle WebSocket connections

## Architecture

```
User's Browser <--> Cloudflare Worker (WebSocket) <--> Gemini Live API
```

1. User clicks voice button in browser
2. Browser captures audio using Web Audio API
3. Audio is encoded as PCM and sent via WebSocket to Cloudflare Worker
4. Worker forwards audio to Gemini Live API
5. Gemini processes audio and responds with native audio
6. Worker forwards audio response back to browser
7. Browser plays audio using Web Audio API

## Prerequisites

- Cloudflare account with Workers enabled
- Gemini API key from Google AI Studio
- Wrangler CLI installed (`npm install -g wrangler`)

## Deployment Steps

### 1. Install Wrangler (if not already installed)

```bash
npm install -g wrangler
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

This will open a browser window for authentication.

### 3. Set up the Gemini API Key

The voice worker uses the same API key as the text chatbot worker. If you haven't set it up yet:

```bash
wrangler secret put GEMINI_API_KEY --config wrangler-voice.toml
```

When prompted, paste your Gemini API key.

### 4. Deploy the Voice Worker

```bash
wrangler deploy --config wrangler-voice.toml
```

After deployment, Cloudflare will provide you with a worker URL like:
```
https://portfolio-voice-worker.your-subdomain.workers.dev
```

### 5. Update the Frontend

Edit `main.html` and update the `VOICE_WORKER_URL` constant (around line 5779):

```javascript
const VOICE_WORKER_URL = 'https://portfolio-voice-worker.your-subdomain.workers.dev';
```

### 6. Deploy to Cloudflare Pages

Deploy your updated website:

```bash
wrangler pages deploy . --compatibility-date 2024-01-01
```

Or commit and push to GitHub if using GitHub Pages.

## Testing the Voice Feature

1. Open your portfolio website
2. Look for the microphone icon next to the chat input
3. Click the microphone to start voice interaction
4. Allow microphone access when prompted
5. Speak your question about Michael's experience
6. Click the microphone again to stop recording
7. Listen to the AI's voice response

## Voice Configuration

The voice assistant uses the following settings (configurable in `voice-worker.js`):

- **Voice**: Puck (other options: Charon, Kore, Fenrir, Aoede)
- **Audio Format**: 16-bit PCM at 16kHz mono
- **Response Modality**: Audio only
- **Generation Config**: Optimized for conversational responses

To change the voice, edit the `setupMessage` in `voice-worker.js`:

```javascript
speech_config: {
  voice_config: {
    prebuilt_voice_config: {
      voice_name: 'Puck' // Change to: Charon, Kore, Fenrir, or Aoede
    }
  }
}
```

## Troubleshooting

### Voice button not appearing
- Check that `voice-interaction.js` is being loaded
- Verify the script is included before the integration code
- Check browser console for errors

### "Microphone access denied" error
- Grant microphone permissions in your browser
- On mobile, ensure HTTPS is being used
- Check browser settings for microphone access

### Connection fails
- Verify the VOICE_WORKER_URL is correct
- Check that the worker is deployed: `wrangler deployments list --name portfolio-voice-worker`
- Verify API key is set: `wrangler secret list --config wrangler-voice.toml`

### No audio playback
- Check browser console for decoding errors
- Verify audio context is allowed (some browsers require user interaction first)
- Try clicking somewhere on the page before using voice

### Worker logs
To debug issues, tail the worker logs:

```bash
wrangler tail --config wrangler-voice.toml
```

## Security Considerations

1. **API Key Protection**: The Gemini API key is stored as a Cloudflare secret, never exposed to clients
2. **CORS**: The worker only accepts connections from allowed origins (configurable in `voice-worker.js`)
3. **WebSocket Authentication**: Consider adding authentication if needed for production
4. **Rate Limiting**: Implement rate limiting in the worker for production use

## Browser Compatibility

The voice feature requires:
- WebSocket support
- Web Audio API
- getUserMedia API (for microphone access)

Supported browsers:
- Chrome/Edge 87+
- Firefox 86+
- Safari 14.1+
- Mobile browsers (iOS Safari 14.5+, Chrome Mobile)

## Cost Considerations

### Cloudflare Workers
- Free tier: 100,000 requests/day
- Voice interactions use WebSocket connections (counted as 1 request per connection)

### Gemini API
- Check current pricing at https://ai.google.dev/pricing
- Audio tokens are typically charged differently than text tokens
- Monitor usage in Google AI Studio

## Advanced Configuration

### Custom System Instructions

Edit the `system_instruction` in `voice-worker.js` to customize the assistant's behavior:

```javascript
system_instruction: {
  parts: [{
    text: `Your custom instructions here...`
  }]
}
```

### Audio Quality Settings

For better quality at the cost of bandwidth, you can increase sample rate (requires changes in both browser and worker):

```javascript
// In voice-interaction.js
this.audioContext = new AudioContext({
  sampleRate: 24000 // or 48000 for highest quality
});
```

### Add Conversation Context

The voice worker can be enhanced to include context from the text chatbot by maintaining a shared conversation history.

## Files Overview

- `voice-worker.js` - Cloudflare Worker handling WebSocket connections to Gemini Live API
- `voice-interaction.js` - Browser-side JavaScript for audio capture and playback
- `wrangler-voice.toml` - Wrangler configuration for voice worker
- `main.html` - Updated with voice UI and integration code

## Next Steps

- Consider adding visual feedback during audio playback
- Implement conversation history shared between text and voice
- Add support for interrupting the AI mid-response
- Implement voice activity detection for hands-free mode
- Add language selection for multi-lingual support

## Support

For issues or questions:
- Check Cloudflare Workers documentation: https://developers.cloudflare.com/workers/
- Gemini Live API docs: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api
- Open an issue in the GitHub repository
