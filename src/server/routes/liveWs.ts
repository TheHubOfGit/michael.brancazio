import { Env } from '../types/worker';
import { CONFIG } from '../config';
import { logAuditEntry } from '../middleware/logger';
import { errorResponse } from '../middleware/errorHandler';
import { checkRateLimit, getClientIp, getRateLimitHeaders } from '../middleware/rateLimit';
import { getCorsHeaders } from '../middleware/cors';
import { buildVoicePrompt } from '../services/contextEngine';

type ClientMessage = string | ArrayBuffer;

/**
 * The browser drives the session, but the server decides what reaches Gemini: the first
 * message must be a setup, whose model, voice and rules are fixed here, and later messages
 * may only carry realtime audio/text or conversation turns. Anything else is dropped.
 */
export function createClientFilter() {
  let setupSent = false;
  const decoder = new TextDecoder();
  return (data: ClientMessage): string | null => {
    let message: Record<string, any>;
    try { message = JSON.parse(typeof data === 'string' ? data : decoder.decode(data)); } catch { return null; }
    if (!message || typeof message !== 'object') return null;
    if (!setupSent) {
      if (!message.setup || typeof message.setup !== 'object') return null;
      setupSent = true;
      const clientContext = message.setup.systemInstruction?.parts?.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('\n') || '';
      return JSON.stringify({
        setup: {
          model: CONFIG.MODELS.LIVE,
          systemInstruction: { parts: [{ text: `${buildVoicePrompt()}\n\nPortfolio context:\n${clientContext.slice(0, CONFIG.LIMITS.CONTEXT_CHARACTERS)}` }] },
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: CONFIG.LIVE_VOICE } } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
    }
    if (message.realtimeInput) return JSON.stringify({ realtimeInput: message.realtimeInput });
    if (message.clientContent) return JSON.stringify({ clientContent: message.clientContent });
    return null;
  };
}

function safeClose(socket: WebSocket, code: number, reason: string) {
  if (socket.readyState === WebSocket.CLOSED) return;
  try { socket.close(code, reason); } catch {
    // A peer may finish closing between checking readyState and calling close.
    try { socket.close(); } catch { /* Already disconnected. */ }
  }
}

function normalizeCloseCode(code: number): number {
  if ([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014].includes(code) || (code >= 3000 && code <= 4999)) return code;
  // 1005 and 1006 describe local state and cannot be sent in a Close frame.
  return 1011;
}

/** Owns both sockets and all timers for a single voice session. */
export function bridgeWebSockets(server: WebSocket, upstream: WebSocket, onClose: (code: number) => void, filter?: (data: ClientMessage) => ClientMessage | null): () => void {
  const buffer: (string | ArrayBuffer)[] = [];
  const encoder = new TextEncoder();
  let bufferedBytes = 0;
  let ended = false;
  const connectTimer = setTimeout(() => close(1013, 'Voice service connection timed out'), CONFIG.LIMITS.LIVE_CONNECT_TIMEOUT_MS);
  const sessionTimer = setTimeout(() => close(1000, 'Voice session ended. Reconnect to continue.'), CONFIG.LIMITS.LIVE_SESSION_TIMEOUT_MS);

  function close(code: number, reason: string) {
    if (ended) return;
    ended = true;
    clearTimeout(connectTimer);
    clearTimeout(sessionTimer);
    buffer.length = 0;
    bufferedBytes = 0;
    safeClose(server, normalizeCloseCode(code), reason);
    safeClose(upstream, normalizeCloseCode(code), reason);
    onClose(code);
  }

  function send(socket: WebSocket, data: string | ArrayBuffer) {
    try { socket.send(data); } catch { close(1011, 'Voice connection interrupted'); }
  }

  upstream.addEventListener('open', () => {
    clearTimeout(connectTimer);
    if (ended) { safeClose(upstream, 1000, 'Session ended'); return; }
    for (const message of buffer) {
      if (ended) break;
      send(upstream, message);
    }
    buffer.length = 0;
    bufferedBytes = 0;
  });
  upstream.addEventListener('message', (event) => {
    if (!ended && server.readyState === WebSocket.OPEN) send(server, event.data);
  });
  upstream.addEventListener('close', (event) => close(event.code, event.code === 1000 ? 'Voice session ended' : 'Voice service disconnected'));
  upstream.addEventListener('error', () => close(1011, 'Voice service connection error'));
  server.addEventListener('error', () => close(1011, 'Voice client connection error'));
  server.addEventListener('close', (event) => close(event.code, 'Voice session ended'));
  server.addEventListener('message', (event) => {
    if (ended) return;
    const data = event.data;
    const bytes = typeof data === 'string' ? encoder.encode(data).byteLength : data.byteLength;
    if (bytes > CONFIG.LIMITS.LIVE_MESSAGE_BYTES) { close(1009, 'Voice message is too large'); return; }
    const forwarded = filter ? filter(data) : data;
    if (forwarded === null) return;
    if (upstream.readyState === WebSocket.OPEN) {
      send(upstream, forwarded);
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      if (buffer.length >= CONFIG.LIMITS.LIVE_BUFFER_MESSAGES || bufferedBytes + bytes > CONFIG.LIMITS.LIVE_BUFFER_BYTES) {
        close(1009, 'Voice connection buffer is full');
        return;
      }
      buffer.push(forwarded);
      bufferedBytes += bytes;
    } else {
      close(1011, 'Voice service disconnected');
    }
  });
  return () => close(1000, 'Voice session ended');
}

export async function handleLiveWebSocket(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  const audit = {
    timestamp: new Date().toISOString(), clientIp: getClientIp(request),
    origin: request.headers.get('Origin') || 'unknown', endpoint: '/api/live', inputMode: 'voice' as const,
  };
  const rateLimit = checkRateLimit(request);
  const rateHeaders = getRateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return errorResponse(`Too many requests. Please retry in ${rateLimit.reset} seconds.`, 429, request, undefined, env, rateHeaders);
  }
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return errorResponse('API key not configured', 500, request, undefined, env, rateHeaders);

  let server: WebSocket | undefined;
  let upstream: WebSocket | undefined;
  let stopBridge: (() => void) | undefined;
  try {
    const [client, workerSocket] = Object.values(new WebSocketPair());
    server = workerSocket;
    server.binaryType = 'arraybuffer';
    server.accept();
    upstream = new WebSocket(`${CONFIG.GEMINI_LIVE_WS_BASE}?key=${encodeURIComponent(apiKey)}`);
    upstream.binaryType = 'arraybuffer';
    stopBridge = bridgeWebSockets(server, upstream, (code) => {
      logAuditEntry({ ...audit, status: code === 1000 || code === 1001 ? 200 : 502, latencyMs: Date.now() - startTime });
    }, createClientFilter());
    logAuditEntry({ ...audit, status: 101, latencyMs: Date.now() - startTime });
    return new Response(null, { status: 101, webSocket: client, headers: { ...getCorsHeaders(request, env), ...rateHeaders } });
  } catch {
    stopBridge?.();
    if (server) safeClose(server, 1011, 'Voice connection failed');
    if (upstream) safeClose(upstream, 1011, 'Voice connection failed');
    logAuditEntry({ ...audit, status: 502, latencyMs: Date.now() - startTime, error: 'Voice connection failed' });
    return errorResponse('Voice service is unavailable. Please try again.', 502, request, undefined, env, rateHeaders);
  }
}
