import { Env, ChatRequestPayload } from '../types/worker';
import { callGemini, callGeminiStream } from '../services/gemini';
import { getCorsHeaders } from '../middleware/cors';
import { checkRateLimit } from '../middleware/rateLimit';
import { logAuditEntry } from '../middleware/logger';
import { jsonResponse, errorResponse } from '../middleware/errorHandler';

export async function handleChat(request: Request, env: Env): Promise<Response> {
  const startTime = Date.now();
  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const origin = request.headers.get('Origin') || 'unknown';

  // 1. Rate Limiting
  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    logAuditEntry({
      timestamp: new Date().toISOString(),
      clientIp,
      origin,
      endpoint: '/api/chat',
      inputMode: 'unknown',
      status: 429,
      latencyMs: Date.now() - startTime,
      error: 'Rate limit exceeded',
    });
    return errorResponse(`Too many requests. Please retry in ${rateLimit.reset} seconds.`, 429, request);
  }

  // 2. Parse & Validate Payload
  let payload: ChatRequestPayload;
  try {
    payload = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400, request);
  }

  const { message, context, stream, sessionId, inputMode = 'text', promptIndex } = payload;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return errorResponse('Message is required', 400, request);
  }

  if (message.length > 5000) {
    return errorResponse('Message exceeds maximum allowed length of 5000 characters', 400, request);
  }

  // 3. Check Gemini API Key
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    logAuditEntry({
      timestamp: new Date().toISOString(),
      sessionId,
      clientIp,
      origin,
      endpoint: '/api/chat',
      inputMode,
      promptIndex,
      promptText: message.slice(0, 200),
      status: 500,
      latencyMs: Date.now() - startTime,
      error: 'API key not configured',
    });
    return errorResponse('API key not configured', 500, request);
  }

  // 4. Handle Streaming Request
  if (stream) {
    try {
      const { stream: geminiStream, modelUsed } = await callGeminiStream({
        message,
        context,
        apiKey,
      });

      logAuditEntry({
        timestamp: new Date().toISOString(),
        sessionId,
        clientIp,
        origin,
        endpoint: '/api/chat',
        inputMode,
        promptIndex,
        promptText: message.slice(0, 200),
        modelUsed,
        status: 200,
        latencyMs: Date.now() - startTime,
      });

      const cors = getCorsHeaders(request);
      return new Response(geminiStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...cors,
        },
      });
    } catch (err: any) {
      logAuditEntry({
        timestamp: new Date().toISOString(),
        sessionId,
        clientIp,
        origin,
        endpoint: '/api/chat',
        inputMode,
        promptIndex,
        promptText: message.slice(0, 200),
        status: 500,
        latencyMs: Date.now() - startTime,
        error: err?.message || 'Streaming failed',
      });
      return errorResponse(err?.message || 'Streaming failed', 500, request);
    }
  }

  // 5. Standard JSON Request
  try {
    const result = await callGemini({
      message,
      context,
      apiKey,
    });

    logAuditEntry({
      timestamp: new Date().toISOString(),
      sessionId,
      clientIp,
      origin,
      endpoint: '/api/chat',
      inputMode,
      promptIndex,
      promptText: message.slice(0, 200),
      modelUsed: result.modelUsed,
      status: 200,
      latencyMs: result.latencyMs,
    });

    return jsonResponse(
      {
        response: result.text,
        modelUsed: result.modelUsed,
        latencyMs: result.latencyMs,
      },
      200,
      request
    );
  } catch (err: any) {
    logAuditEntry({
      timestamp: new Date().toISOString(),
      sessionId,
      clientIp,
      origin,
      endpoint: '/api/chat',
      inputMode,
      promptIndex,
      promptText: message.slice(0, 200),
      status: 500,
      latencyMs: Date.now() - startTime,
      error: err?.message || 'Generation failed',
    });

    return errorResponse('Failed to get response from AI service', 500, request, err?.message);
  }
}
