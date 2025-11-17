# Gemini Live Voice Interaction Setup

This document explains the implementation of Gemini Live voice interaction for the chatbot.

## Architecture

The implementation uses:
1. **Frontend (Browser)**: Captures audio, converts to PCM format, sends via WebSocket
2. **Cloudflare Worker**: Handles WebSocket upgrades and routes to Durable Object
3. **Cloudflare Durable Object**: Proxies WebSocket connection to Gemini Live API
4. **Gemini Live API**: Processes audio and returns voice responses

## Files Modified/Created

1. **worker.js**: Updated to handle WebSocket upgrades and route to Durable Object
2. **durable-object.js**: New file - handles WebSocket proxying to Gemini Live API
3. **wrangler.toml**: Updated to include Durable Object binding
4. **main.html**: Added voice button UI and voice interaction JavaScript

## Setup Instructions

### 1. Enable Durable Objects

Durable Objects need to be enabled in your Cloudflare account. They are available on paid plans.

### 2. Deploy the Worker

```bash
# Make sure you have the GEMINI_API_KEY secret set
wrangler secret put GEMINI_API_KEY

# Deploy the worker
wrangler deploy
```

### 3. Test the Implementation

1. Open your portfolio page
2. Click the microphone button in the chatbot
3. Grant microphone permissions when prompted
4. Speak into the microphone
5. The chatbot should respond with voice

## Important Notes

### WebSocket Client Creation in Durable Objects

The current implementation uses `new WebSocket()` in the Durable Object to create an outbound connection to Gemini. **This may not work** depending on Cloudflare's WebSocket support in Durable Objects.

If you encounter issues, you may need to:

1. **Alternative Approach**: Have the browser connect directly to Gemini Live API, but use the Worker to generate ephemeral tokens (requires different authentication setup)

2. **Check Cloudflare Documentation**: Verify if Durable Objects support creating outbound WebSocket clients, or if you need to use a different method

3. **Use HTTP Streaming**: As a fallback, you could use HTTP POST with chunked responses instead of WebSockets (though this is less ideal for real-time voice)

### Audio Format Requirements

- **Input**: 16-bit PCM audio at 16kHz, little-endian, mono
- **Output**: 16-bit PCM audio at 24kHz, little-endian, mono

The frontend code handles the conversion automatically.

### Model Used

- Model: `gemini-2.5-flash-native-audio-preview-09-2025`
- This is a preview model with native audio support

## Troubleshooting

### WebSocket Connection Fails

If the WebSocket connection fails, check:
1. Durable Objects are enabled in your Cloudflare account
2. The `GEMINI_API_KEY` secret is set correctly
3. The WebSocket endpoint URL is correct
4. Browser console for error messages

### Audio Not Playing

If audio responses don't play:
1. Check browser console for errors
2. Verify the audio format conversion is working
3. Check that the AudioContext is created with the correct sample rate (24kHz for output)

### Microphone Access Denied

If microphone access is denied:
1. Check browser permissions
2. Ensure the page is served over HTTPS (required for getUserMedia)
3. Check browser console for permission errors

## Future Improvements

1. Add visual feedback for voice activity detection
2. Implement interruption handling (user can interrupt the AI)
3. Add error recovery and reconnection logic
4. Optimize audio buffering for lower latency
5. Add support for multiple languages

