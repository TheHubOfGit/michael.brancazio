import { CONFIG } from '../config';

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (CONFIG.ALLOWED_ORIGINS.includes(origin as any)) return true;
  // Allow all Cloudflare Pages preview deployments
  if (/^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin)) return true;
  return false;
}

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = isAllowedOrigin(origin);
  const matchedOrigin = allowed && origin ? origin : CONFIG.ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': matchedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection, Accept, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

export function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(request)
  });
}
