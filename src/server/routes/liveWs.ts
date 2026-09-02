import { Env } from '../types/worker';
import { CONFIG } from '../config';
import { logAuditEntry } from '../middleware/logger';

export async function handleLiveWebSocket(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const origin = request.headers.get('Origin') || 'unknown';

  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);

  server.accept();

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    server.close(1011, 'API Key missing');
    logAuditEntry({
      timestamp: new Date().toISOString(),
      clientIp,
      origin,
      endpoint: '/api/live',
      inputMode: 'voice',
      status: 500,
      latencyMs: Date.now() - startTime,
      error: 'GEMINI_API_KEY is not set',
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  const geminiUrl = `${CONFIG.GEMINI_LIVE_WS_BASE}?key=${apiKey}`;

  try {
    const geminiWs = new WebSocket(geminiUrl);
    const messageBuffer: (string | ArrayBuffer)[] = [];
    let isGeminiOpen = false;

    geminiWs.addEventListener('open', () => {
      isGeminiOpen = true;
      while (messageBuffer.length > 0) {
        const msg = messageBuffer.shift();
        if (msg) geminiWs.send(msg);
      }
    });

    geminiWs.addEventListener('message', (event) => {
      if (server.readyState === WebSocket.OPEN) {
        server.send(event.data);
      }
    });

    geminiWs.addEventListener('close', (event) => {
      if (server.readyState === WebSocket.OPEN) {
        server.close(event.code, event.reason);
      }
    });

    geminiWs.addEventListener('error', (error) => {
      console.error('Gemini WebSocket error:', error);
      if (server.readyState === WebSocket.OPEN) {
        server.close(1011, 'Gemini connection error');
      }
    });

    // Forward messages from Client to Gemini
    server.addEventListener('message', (event) => {
      if (isGeminiOpen && geminiWs.readyState === WebSocket.OPEN) {
        geminiWs.send(event.data);
      } else if (messageBuffer.length < 50) {
        messageBuffer.push(event.data);
      }
    });

    server.addEventListener('close', (event) => {
      logAuditEntry({
        timestamp: new Date().toISOString(),
        clientIp,
        origin,
        endpoint: '/api/live',
        inputMode: 'voice',
        status: 200,
        latencyMs: Date.now() - startTime,
      });

      if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) {
        geminiWs.close(event.code, event.reason);
      }
    });

    logAuditEntry({
      timestamp: new Date().toISOString(),
      clientIp,
      origin,
      endpoint: '/api/live',
      inputMode: 'voice',
      status: 101,
      latencyMs: Date.now() - startTime,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  } catch (err: any) {
    console.error('Failed to establish WebSocket to Gemini:', err);
    logAuditEntry({
      timestamp: new Date().toISOString(),
      clientIp,
      origin,
      endpoint: '/api/live',
      inputMode: 'voice',
      status: 502,
      latencyMs: Date.now() - startTime,
      error: err?.message,
    });
    return new Response('WebSocket Proxy Error', { status: 502 });
  }
}
