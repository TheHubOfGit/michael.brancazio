import { getCorsHeaders } from './cors';
import { Env } from '../types/worker';

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonResponse(data: unknown, status = 200, request: Request, extraHeaders: Record<string, string> = {}, env?: Env): Response {
  const cors = getCorsHeaders(request, env);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...cors,
      ...extraHeaders
    }
  });
}

export function errorResponse(error: string, status = 500, request: Request, details?: string, env?: Env, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse({
    error,
    ...(details ? { details } : {})
  }, status, request, extraHeaders, env);
}
