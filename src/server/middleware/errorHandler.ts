import { getCorsHeaders } from './cors';

export function jsonResponse(data: unknown, status = 200, request: Request, extraHeaders: Record<string, string> = {}): Response {
  const cors = getCorsHeaders(request);
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...cors,
      ...extraHeaders
    }
  });
}

export function errorResponse(error: string, status = 500, request: Request, details?: string): Response {
  return jsonResponse({
    error,
    ...(details ? { details } : {})
  }, status, request);
}
