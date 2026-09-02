import { CONFIG } from '../config';
import { buildSystemPrompt } from './contextEngine';

export interface GeminiCallOptions {
  message: string;
  context?: string;
  apiKey: string;
}

export interface GeminiResult {
  text: string;
  modelUsed: string;
  latencyMs: number;
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPayload(message: string, context?: string) {
  const fullPrompt = context
    ? `Context: ${context}\n\nUser: ${message}\n\nPlease respond as a helpful AI assistant with the given context.`
    : `${buildSystemPrompt()}\n\nUser: ${message}\n\nPlease respond as a helpful AI assistant.`;

  return {
    contents: [
      {
        parts: [{ text: fullPrompt }],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000,
    },
  };
}

async function callModelWithRetry(
  modelName: string,
  apiKey: string,
  payload: unknown,
  maxRetries = 2
): Promise<Response> {
  const url = `${CONFIG.GEMINI_API_BASE}/${modelName}:generateContent?key=${apiKey}`;

  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // If successful or client error (not rate-limited/overloaded), return immediately
      if (response.ok || (response.status !== 429 && response.status !== 503)) {
        return response;
      }

      lastResponse = response;
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 500 + Math.random() * 200;
        await wait(delay);
      }
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await wait(500);
    }
  }

  return lastResponse!;
}

export async function callGemini(options: GeminiCallOptions): Promise<GeminiResult> {
  const startTime = Date.now();
  const payload = buildPayload(options.message, options.context);

  // 1. Try Primary Model (gemini-3.5-flash-lite)
  let response = await callModelWithRetry(CONFIG.MODELS.PRIMARY, options.apiKey, payload);
  let modelUsed: string = CONFIG.MODELS.PRIMARY;

  // 2. If Primary fails, fallback to Secondary (gemini-2.5-flash-lite)
  if (!response.ok) {
    const primaryError = await response.text();
    console.warn(`Primary model (${CONFIG.MODELS.PRIMARY}) failed, trying fallback (${CONFIG.MODELS.FALLBACK}). Error: ${primaryError}`);

    response = await callModelWithRetry(CONFIG.MODELS.FALLBACK, options.apiKey, payload);
    modelUsed = CONFIG.MODELS.FALLBACK;

    if (!response.ok) {
      const fallbackError = await response.text();
      console.error(`Fallback model (${CONFIG.MODELS.FALLBACK}) also failed. Error: ${fallbackError}`);
      throw new Error(`Gemini API error: ${fallbackError || response.statusText}`);
    }
  }

  const data = (await response.json()) as any;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
  const latencyMs = Date.now() - startTime;

  return {
    text,
    modelUsed,
    latencyMs,
  };
}

export async function callGeminiStream(
  options: GeminiCallOptions
): Promise<{ stream: ReadableStream; modelUsed: string }> {
  const payload = buildPayload(options.message, options.context);
  let modelUsed: string = CONFIG.MODELS.PRIMARY;
  let url = `${CONFIG.GEMINI_API_BASE}/${CONFIG.MODELS.PRIMARY}:streamGenerateContent?alt=sse&key=${options.apiKey}`;

  let response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    console.warn(`Streaming primary model failed (${response.status}), falling back to ${CONFIG.MODELS.FALLBACK}`);
    modelUsed = CONFIG.MODELS.FALLBACK;
    url = `${CONFIG.GEMINI_API_BASE}/${CONFIG.MODELS.FALLBACK}:streamGenerateContent?alt=sse&key=${options.apiKey}`;
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Streaming error: ${err}`);
    }
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  return {
    stream: response.body,
    modelUsed,
  };
}
