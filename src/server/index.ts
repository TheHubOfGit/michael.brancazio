import { Env } from './types/worker';
import { handleOptions } from './middleware/cors';
import { handleChat } from './routes/chat';
import { handleLiveWebSocket } from './routes/liveWs';
import { handleHealth } from './routes/health';
import { errorResponse } from './middleware/errorHandler';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // 2. WebSocket Upgrade (Gemini Live Voice)
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket' || pathname === '/api/live') {
      return handleLiveWebSocket(request, env);
    }

    // 3. Health Check
    if (pathname === '/api/health' || pathname === '/health' || pathname === '/status') {
      return handleHealth(request, env);
    }

    // 4. Chat Endpoint (New /api/chat or legacy root /)
    if ((pathname === '/api/chat' || pathname === '/') && request.method === 'POST') {
      return handleChat(request, env);
    }

    // 5. Method / Path Not Found
    if (request.method !== 'POST' && request.method !== 'GET') {
      return errorResponse('Method not allowed', 405, request);
    }

    return errorResponse('Not found', 404, request);
  },
};
