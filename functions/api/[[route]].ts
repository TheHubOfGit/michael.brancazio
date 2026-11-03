import { Env } from '../../src/server/types/worker';
import { handleOptions, isAllowedOrigin } from '../../src/server/middleware/cors';
import { handleChat } from '../../src/server/routes/chat';
import { handleHealth } from '../../src/server/routes/health';
import { handleLiveWebSocket } from '../../src/server/routes/liveWs';
import { handleFrameCheck } from '../../src/server/routes/frameCheck';
import { errorResponse } from '../../src/server/middleware/errorHandler';

interface PagesContext {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

// Same routing and guards as the portfolio chatbot worker, served as a Pages Function under /api/*.
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  try {
    const { pathname } = new URL(request.url);
    const isHealth = pathname === '/api/health';
    const isChat = pathname === '/api/chat';
    const isLive = pathname === '/api/live';
    const isFrameCheck = pathname === '/api/frame-check';
    const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (!isHealth && !isChat && !isLive && !isFrameCheck) return errorResponse('Not found', 404, request, undefined, env);

    if (request.method === 'OPTIONS') return handleOptions(request, env);
    const origin = request.headers.get('Origin');
    if (origin && !isSameOrigin(request, origin) && !isAllowedOrigin(origin, env)) {
      return errorResponse('Origin is not allowed', 403, request, undefined, env);
    }

    if (isHealth && (request.method === 'GET' || request.method === 'HEAD')) {
      const response = handleHealth(request, env);
      return request.method === 'HEAD' ? new Response(null, response) : response;
    }
    if (isFrameCheck && request.method === 'GET') return await handleFrameCheck(request, env);
    if (isLive) {
      if (request.method !== 'GET') return errorResponse('Method not allowed', 405, request, undefined, env, { Allow: 'GET, OPTIONS' });
      if (!isUpgrade) return errorResponse('WebSocket upgrade required', 426, request, undefined, env, { Upgrade: 'websocket' });
      return await handleLiveWebSocket(request, env);
    }
    if (isChat && request.method === 'POST') {
      return await handleChat(request, env, { waitUntil: (p: Promise<unknown>) => context.waitUntil(p) } as unknown as ExecutionContext);
    }
    return errorResponse('Method not allowed', 405, request, undefined, env, { Allow: isHealth ? 'GET, HEAD, OPTIONS' : 'POST, OPTIONS' });
  } catch {
    console.error(JSON.stringify({ type: 'request_failure', method: request.method, path: new URL(request.url).pathname }));
    return errorResponse('Internal server error', 500, request, undefined, env);
  }
}

// The site and its API share an origin, so every deployment (production or preview) can call itself.
function isSameOrigin(request: Request, origin: string): boolean {
  return new URL(request.url).origin === origin;
}
