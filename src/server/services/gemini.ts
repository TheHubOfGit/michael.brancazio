import { CONFIG } from '../config';
import { readBoundedText } from '../middleware/body';
import { buildSystemPrompt } from './contextEngine';

export interface GeminiCallOptions {
  message: string;
  context?: string;
  apiKey: string;
  signal?: AbortSignal;
}

export interface GeminiResult {
  text: string;
  modelUsed: string;
  latencyMs: number;
}

export class GeminiServiceError extends Error {
  constructor(public readonly status = 502, public readonly upstreamStatus?: number) {
    super(status === 504 ? 'AI service timed out. Please try again.' : status === 499 ? 'Request cancelled' : 'Failed to get response from AI service');
    this.name = 'GeminiServiceError';
  }
}

function buildPayload(message: string, context?: string) {
  return {
    systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
    contents: [{ role: 'user', parts: [{ text: context ? `Portfolio context and conversation history:\n${context}\n\nCurrent question: ${message}` : message }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 },
  };
}

function createRequestScope(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  let timedOut = false;
  const onAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  if (parentSignal?.aborted) onAbort();
  const resetTimeout = (duration: number) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, duration);
  };
  resetTimeout(CONFIG.LIMITS.PROVIDER_TIMEOUT_MS);
  return {
    signal: controller.signal,
    resetTimeout,
    abort: () => controller.abort(),
    error: () => new GeminiServiceError(parentSignal?.aborted ? 499 : timedOut ? 504 : 502),
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', onAbort);
    },
  };
}

type RequestScope = ReturnType<typeof createRequestScope>;

function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new GeminiServiceError(504)); return; }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GeminiServiceError(504));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 250);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function requestModel(model: string, options: GeminiCallOptions, scope: RequestScope, streaming: boolean): Promise<Response> {
  const operation = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const url = `${CONFIG.GEMINI_API_BASE}/${model}:${operation}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (scope.signal.aborted) throw scope.error();
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify(buildPayload(options.message, options.context)),
        signal: scope.signal,
      });
      if (response.ok) return response;
      await response.body?.cancel().catch(() => undefined);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 1) throw new GeminiServiceError(502, response.status);
    } catch (error) {
      if (scope.signal.aborted) throw scope.error();
      if (error instanceof GeminiServiceError || attempt === 1) throw error instanceof GeminiServiceError ? error : scope.error();
    }
    await waitForRetry(scope.signal);
  }
  throw scope.error();
}

function extractText(data: unknown): string {
  if (!data || typeof data !== 'object') throw new GeminiServiceError();
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) throw new GeminiServiceError();
  const parts: unknown = candidates[0]?.content?.parts;
  if (!Array.isArray(parts)) throw new GeminiServiceError();
  const text = parts
    .filter((part): part is { text: string } => Boolean(part && typeof part === 'object' && typeof part.text === 'string' && part.thought !== true))
    .map((part) => part.text)
    .join('')
    .trim();
  if (!text) throw new GeminiServiceError();
  return text;
}

function normalizeError(error: unknown, scope: RequestScope): GeminiServiceError {
  return scope.signal.aborted ? scope.error() : error instanceof GeminiServiceError ? error : new GeminiServiceError();
}

function shouldStop(error: GeminiServiceError): boolean {
  return error.status === 499 || error.upstreamStatus === 401 || error.upstreamStatus === 403;
}

export async function callGemini(options: GeminiCallOptions): Promise<GeminiResult> {
  const startedAt = Date.now();
  let lastError = new GeminiServiceError();
  for (const model of [CONFIG.MODELS.PRIMARY, CONFIG.MODELS.FALLBACK]) {
    const scope = createRequestScope(options.signal);
    try {
      const response = await requestModel(model, options, scope, false);
      const text = extractText(JSON.parse(await readBoundedText(response.body, CONFIG.LIMITS.PROVIDER_RESPONSE_BYTES)));
      return { text, modelUsed: model, latencyMs: Date.now() - startedAt };
    } catch (error) {
      lastError = normalizeError(error, scope);
      console.warn(JSON.stringify({ type: 'ai_provider_failure', model, status: lastError.status, upstreamStatus: lastError.upstreamStatus }));
      if (shouldStop(lastError)) throw lastError;
    } finally {
      scope.dispose();
    }
  }
  throw lastError;
}

function forwardStream(body: ReadableStream<Uint8Array>, scope: RequestScope): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let finished = false;
  let onAbort: () => void;
  const cleanup = () => {
    finished = true;
    scope.signal.removeEventListener('abort', onAbort);
    scope.dispose();
  };
  const cancelReader = async (reason?: unknown) => {
    await reader.cancel(reason).catch(() => undefined);
    reader.releaseLock();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        if (finished) return;
        const error = scope.error();
        cleanup();
        controller.error(error);
        void cancelReader(error);
      };
      scope.signal.addEventListener('abort', onAbort, { once: true });
      if (scope.signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (finished) return;
        if (done) { cleanup(); reader.releaseLock(); controller.close(); }
        else controller.enqueue(value);
      } catch {
        if (finished) return;
        const error = scope.error();
        cleanup();
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      cleanup();
      scope.abort();
      await cancelReader(reason);
    },
  });
}

export async function callGeminiStream(options: GeminiCallOptions): Promise<{ stream: ReadableStream<Uint8Array>; modelUsed: string }> {
  let lastError = new GeminiServiceError();
  for (const model of [CONFIG.MODELS.PRIMARY, CONFIG.MODELS.FALLBACK]) {
    const scope = createRequestScope(options.signal);
    try {
      const response = await requestModel(model, options, scope, true);
      if (!response.body || !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/event-stream')) {
        await response.body?.cancel().catch(() => undefined);
        throw new GeminiServiceError();
      }
      scope.resetTimeout(CONFIG.LIMITS.STREAM_TIMEOUT_MS);
      return { stream: forwardStream(response.body, scope), modelUsed: model };
    } catch (error) {
      lastError = normalizeError(error, scope);
      scope.dispose();
      console.warn(JSON.stringify({ type: 'ai_provider_failure', streaming: true, model, status: lastError.status, upstreamStatus: lastError.upstreamStatus }));
      if (shouldStop(lastError)) throw lastError;
    }
  }
  throw lastError;
}
