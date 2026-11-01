# Gemini Live implementation

The voice assistant connects the browser's microphone and speakers to Gemini through a Cloudflare Worker. The browser never receives the Gemini API key.

## Request flow

1. `MichaelsChatbot` in `assets/js/chatbot.js` requests microphone access after the user starts voice mode.
2. The client opens a WebSocket to the configured `CHATBOT_WORKER_URL` using `ws:` for local HTTP or `wss:` for HTTPS.
3. `src/server/index.ts` validates routing, origin, and rate limits, then `src/server/routes/liveWs.ts` connects to Gemini with the server-side `GEMINI_API_KEY` secret.
4. The browser sends Gemini's setup message. After setup completes, microphone audio is converted to PCM and sent through the socket.
5. Gemini audio messages return through the proxy. The browser queues playback and displays connection status.

`worker.js` is only a compatibility re-export. The active implementation is under `src/server/`, selected by `wrangler.jsonc`.

## Configuration sources

Keep these values in sync with the code instead of copying a model name or API version from an old guide:

| Setting | Source |
| --- | --- |
| Worker origin | `CHATBOT_WORKER_URL` in `main.html`, optionally overridden at build time |
| Live upstream WebSocket endpoint | `CONFIG.GEMINI_LIVE_WS_BASE` in `src/server/config.ts` |
| Live model, voice, and setup options | Voice setup message in `assets/js/chatbot.js` |
| Allowed browser origins | `src/server/config.ts` plus `ALLOWED_ORIGINS` |
| Gemini credential | `.dev.vars` locally; Worker secret in production |

The Live API is independent of the text-chat model fallback. Verify current availability and message shapes in [Google's Live API documentation](https://ai.google.dev/gemini-api/docs/live) before changing a model or protocol version.

## Audio lifecycle

The frontend uses an inline AudioWorklet to capture audio, converts float samples to signed 16-bit PCM, and base64-encodes chunks for Gemini. Playback uses Web Audio scheduling. User interruption cancels queued playback; ending the session releases microphone tracks, audio nodes, the worklet URL, and the socket.

Keep the PCM sample-rate declaration aligned with the samples actually sent. Browsers may capture at a device's native sample rate even when another rate is requested. Upstream PCM output must likewise be played at its declared sample rate. Handle malformed or missing audio payloads without ending the rest of the portfolio UI.

The Worker bounds the pending connection buffer and closes paired sockets when either side fails or disconnects. Its operational logs record connection status and duration; it does not persist voice audio in the `chat_logs` table.

## Local verification

```bash
cp .dev.vars.example .dev.vars
# Set your Gemini key in .dev.vars, then start the Worker:
npm run dev
```

In another terminal:

```bash
CHATBOT_WORKER_URL=http://localhost:8787 npm run dev:site
```

Open `http://127.0.0.1:8080` in a browser with microphone support. Start voice, speak a short question, interrupt playback, stop, and start again. Confirm the microphone indicator turns off after stopping or closing the assistant. Test denied microphone access and a disconnected network as well.

`npm run check` validates local code and regressions; it does not exercise Google's live service. A real voice smoke test requires a valid key, an available Live model, network access, and microphone permission.
