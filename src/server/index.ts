import { Env } from './types/worker';
import { handleOptions, isAllowedOrigin } from './middleware/cors';
import { handleChat } from './routes/chat';
import { handleLiveWebSocket } from './routes/liveWs';
import { handleHealth } from './routes/health';
import { errorResponse } from './middleware/errorHandler';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const { pathname } = new URL(request.url);
      const isHealth = ['/api/health', '/health', '/status'].includes(pathname);
      const isChat = pathname === '/api/chat' || pathname === '/';
      const isLive = pathname === '/api/live';
      const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
      if (!isHealth && !isChat && !isLive) return errorResponse('Not found', 404, request, undefined, env);

      if (request.method === 'OPTIONS') return handleOptions(request, env);
      const origin = request.headers.get('Origin');
      if (origin && !isAllowedOrigin(origin, env)) {
        return errorResponse('Origin is not allowed', 403, request, undefined, env);
      }

      if (isHealth && !isUpgrade && (request.method === 'GET' || request.method === 'HEAD')) {
        const response = handleHealth(request, env);
        return request.method === 'HEAD' ? new Response(null, response) : response;
      }
      // Preserve the original root WebSocket URL for existing portfolio clients.
      if (isLive || (pathname === '/' && isUpgrade)) {
        if (request.method !== 'GET') return errorResponse('Method not allowed', 405, request, undefined, env, { Allow: 'GET, OPTIONS' });
        if (!isUpgrade) return errorResponse('WebSocket upgrade required', 426, request, undefined, env, { Upgrade: 'websocket' });
        return await handleLiveWebSocket(request, env);
      }
      if (isChat && request.method === 'POST' && !isUpgrade) return await handleChat(request, env, ctx);
      if (pathname === '/' && request.method === 'GET' && !isUpgrade) return errorResponse('Not found', 404, request, undefined, env);
      return errorResponse('Method not allowed', 405, request, undefined, env, { Allow: isHealth ? 'GET, HEAD, OPTIONS' : 'POST, OPTIONS' });
    } catch {
      console.error(JSON.stringify({ type: 'request_failure', method: request.method, path: new URL(request.url).pathname }));
      return errorResponse('Internal server error', 500, request, undefined, env);
    }
  },
} satisfies ExportedHandler<Env>;
