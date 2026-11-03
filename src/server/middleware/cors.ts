import { CONFIG } from '../config';
import { Env } from '../types/worker';

export function isAllowedOrigin(origin: string | null, env?: Env): boolean {
  if (!origin || origin === 'null') return false;
  if (CONFIG.ALLOWED_ORIGINS.some((allowed) => allowed === origin)) return true;
  if (env?.ALLOWED_ORIGINS?.split(',').some((allowed) => allowed.trim() === origin)) return true;
  // Only preview deployments of this Pages project are trusted.
  return /^https:\/\/[a-z0-9-]+\.michaelbrancazio-os\.pages\.dev$/i.test(origin);
}

export function getCorsHeaders(request: Request, env?: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && isAllowedOrigin(origin, env)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, HEAD, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Accept, Authorization, X-Requested-With';
    headers['Access-Control-Expose-Headers'] = 'Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset, X-Model-Used';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

export function handleOptions(request: Request, env?: Env): Response {
  const origin = request.headers.get('Origin');
  return new Response(null, {
    status: origin && !isAllowedOrigin(origin, env) ? 403 : 204,
    headers: getCorsHeaders(request, env),
  });
}
