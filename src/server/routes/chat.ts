import { Env } from '../types/worker';
import { callGemini, callGeminiStream, GeminiServiceError } from '../services/gemini';
import { getCorsHeaders } from '../middleware/cors';
import { checkRateLimit, getClientIp, getRateLimitHeaders } from '../middleware/rateLimit';
import { parseChatPayload } from '../middleware/body';
import { logAuditEntry } from '../middleware/logger';
import { jsonResponse, errorResponse, HttpError } from '../middleware/errorHandler';

export async function handleChat(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const startTime = Date.now();
  const clientIp = getClientIp(request);
  const origin = request.headers.get('Origin') || 'unknown';
  const rateLimit = checkRateLimit(request);
  const rateHeaders = getRateLimitHeaders(rateLimit);
  const audit = { timestamp: new Date().toISOString(), clientIp, origin, endpoint: '/api/chat' };
  if (!rateLimit.allowed) {
    logAuditEntry({ ...audit, inputMode: 'unknown', status: 429, error: 'Rate limit exceeded' });
    return errorResponse(`Too many requests. Please retry in ${rateLimit.reset} seconds.`, 429, request, undefined, env, rateHeaders);
  }

  let payload;
  try {
    payload = await parseChatPayload(request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return errorResponse(error instanceof HttpError ? error.message : 'Invalid request body', status, request, undefined, env, rateHeaders);
  }
  const { message, context, stream, sessionId, inputMode = 'text', promptIndex } = payload;
  const details = { ...audit, sessionId, inputMode, promptIndex };
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    logAuditEntry({ ...details, status: 500, error: 'API key not configured', latencyMs: Date.now() - startTime });
    return errorResponse('API key not configured', 500, request, undefined, env, rateHeaders);
  }

  try {
    const options = { message, context, apiKey, signal: request.signal };
    if (stream) {
      const { stream: geminiStream, modelUsed } = await callGeminiStream(options);
      logAuditEntry({ ...details, modelUsed, status: 200, latencyMs: Date.now() - startTime });
      return new Response(geminiStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Model-Used': modelUsed,
          ...getCorsHeaders(request, env),
          ...rateHeaders,
        },
      });
    }

    const result = await callGemini(options);
    logAuditEntry({ ...details, modelUsed: result.modelUsed, status: 200, latencyMs: result.latencyMs });

    // Both synchronous binding errors and rejected writes must not fail a good answer.
    if (env.DB && ctx?.waitUntil) {
      const database = env.DB;
      ctx.waitUntil(Promise.resolve().then(() => database.prepare(
        `INSERT INTO chat_logs (timestamp, session_id, client_ip, input_mode, prompt_index, prompt_text, response_text, model_used, latency_ms, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        new Date().toISOString(), sessionId || null, clientIp, inputMode,
        promptIndex ?? null, message, result.text, result.modelUsed, result.latencyMs, 200
      ).run()).catch(() => console.error(JSON.stringify({ type: 'chat_log_failure', storage: 'D1' }))));
    }

    return jsonResponse({ response: result.text, modelUsed: result.modelUsed, latencyMs: result.latencyMs }, 200, request, rateHeaders, env);
  } catch (error) {
    const serviceError = error instanceof GeminiServiceError ? error : new GeminiServiceError();
    logAuditEntry({ ...details, status: serviceError.status, error: serviceError.message, latencyMs: Date.now() - startTime });
    return errorResponse(serviceError.message, serviceError.status, request, undefined, env, rateHeaders);
  }
}
