# Gemini Live Technical Implementation Guide

## Overview
This application utilizes Google's **Gemini Multimodal Live API** to provide real-time, bidirectional voice interaction. The architecture consists of a client-side frontend that captures/plays audio and a server-side Cloudflare Worker that acts as a secure proxy to the Gemini API.

## 1. Technical Architecture

### Model & API
- **API Endpoint:** `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`
- **Model Used:** `models/gemini-2.5-flash-native-audio-preview-09-2025`
- **Voice Setting:** "Enceladus"
- **Format:** WebSocket (BidiGenerateContent)

### Security (Server-Side)
Directly exposing the API key on the client is insecure. This implementation uses a **Cloudflare Worker** as a middleman.
- **File:** `worker.js`
- **Mechanism:** The worker accepts a WebSocket connection from the browser, validates the origin, appends the server-side `GEMINI_API_KEY`, and establishes a corresponding WebSocket connection to Google. It then pipes messages back and forth.

## 2. Implementation Logic

### Server-Side (`worker.js`)
The worker handles the WebSocket upgrade and streaming:
```javascript
// Accepts client connection
const [client, server] = Object.values(new WebSocketPair());

// Connects to Gemini with hidden Key
const geminiWs = new WebSocket(`wss://.../BidiGenerateContent?key=${env.GEMINI_API_KEY}`);

// Pipes messages
server.addEventListener('message', event => geminiWs.send(event.data));
geminiWs.addEventListener('message', event => server.send(event.data));
```

### Client-Side (`main.html`)
The frontend manages the "Live" experience using the Web Audio API.

#### Audio Capture
1.  **GetUserMedia:** Captures microphone input at 16kHz (required by Gemini).
2.  **AudioWorklet:** A custom `AudioProcessor` collects raw Float32 audio samples.
3.  **PCM Conversion:** Converts Float32 to Int16 PCM logic.
4.  **Encoding:** Base64 encodes the PCM data.
5.  **Sending:** Sends JSON chunks to the WebSocket:
    ```json
    {
      "realtimeInput": {
        "mediaChunks": [{
          "mimeType": "audio/pcm;rate=16000",
          "data": "<base64_encoded_pcm>"
        }]
      }
    }
    ```

#### Audio Playback
1.  **Receiving:** Listens for WebSocket messages containing `audio/pcm` data.
2.  **Decoding:** Base64 decodes the response audio.
3.  **Queueing:** Pushes audio chunks into a queue to ensure smooth playback without gaps.
4.  **Playing:** An `AudioContext` schedules and plays the chunks.

#### Interruption Handling
- The client calculates the **RMS (Root Mean Square)** amplitude of the microphone input.
- If the volume exceeds a threshold (`VOICE_THRESHOLD`), it assumes the user is speaking and:
    - Stops current audio playback.
    - Sends current audio to Gemini (effectively "interrupting" the bot).

## 3. How to Implement in Another Site

### Step 1: Deploy Proxy (Cloudflare Worker)
You cannot use this API purely client-side securely.
1.  Copy `worker.js` to a new Cloudflare Worker.
2.  Set `GEMINI_API_KEY` in the Worker's secrets.
3.  Update the `allowedOrigins` array in `worker.js` to include your new site's domain.

### Step 2: Client Integration
1.  **Context**: Copy the `MichaelsChatbot` class structure from `main.html`.
2.  **AudioWorklet**: You must serve or inline the `AudioRecorderProcessor`. The current implementation inlines it as a Blob URI, which is easiest.
3.  **WebSocket**: Initialize the connection to your Worker URL (not Google directly).
4.  **Protocol**:
    *   **Setup**: Send the initial configuration message (system instructions, voice config) immediately upon connection.
    *   **Loop**: Record -> PCM -> Base64 -> Send.
    *   **Loop**: Receive -> Decode -> Play.

## 4. Key Configuration Parameters
When sending the `setup` message (see `main.html` around line 6120), you can customize:
- `systemInstruction`: The persona and rules for the bot.
- `voiceName`: Options include "Puck", "Charon", "Kore", "Fenrir", "Aoede".
- `responseModalities`: Set to `["AUDIO"]` for voice-only, or `["AUDIO", "TEXT"]` if you want text transcripts too.
