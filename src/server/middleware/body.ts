import { CONFIG } from '../config';
import { ChatRequestPayload } from '../types/worker';
import { HttpError } from './errorHandler';

/** Limit bytes while reading, including chunked bodies without Content-Length. */
export async function readBoundedText(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<string> {
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError('Request body is too large', 413);
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally {
    reader.releaseLock();
  }
}

export async function parseChatPayload(request: Request): Promise<ChatRequestPayload & { message: string }> {
  const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError('Content-Type must be application/json', 415);
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > CONFIG.LIMITS.REQUEST_BYTES) {
    throw new HttpError('Request body is too large', 413);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedText(request.body, CONFIG.LIMITS.REQUEST_BYTES));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError('Invalid JSON body', 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError('Request body must be a JSON object', 400);
  }
  const fields = payload as Record<string, unknown>;
  if (typeof fields.message !== 'string' || !fields.message.trim()) {
    throw new HttpError('Message is required', 400);
  }
  if (fields.message.length > CONFIG.LIMITS.MESSAGE_CHARACTERS) {
    throw new HttpError(`Message exceeds maximum allowed length of ${CONFIG.LIMITS.MESSAGE_CHARACTERS} characters`, 400);
  }
  if (fields.context !== undefined && (typeof fields.context !== 'string' || fields.context.length > CONFIG.LIMITS.CONTEXT_CHARACTERS)) {
    throw new HttpError(`Context must be a string of at most ${CONFIG.LIMITS.CONTEXT_CHARACTERS} characters`, 400);
  }
  if (fields.stream !== undefined && typeof fields.stream !== 'boolean') {
    throw new HttpError('Stream must be a boolean', 400);
  }
  if (fields.sessionId !== undefined && (typeof fields.sessionId !== 'string' || fields.sessionId.length > CONFIG.LIMITS.SESSION_ID_CHARACTERS)) {
    throw new HttpError(`Session ID must be a string of at most ${CONFIG.LIMITS.SESSION_ID_CHARACTERS} characters`, 400);
  }
  if (fields.inputMode !== undefined && fields.inputMode !== 'text' && fields.inputMode !== 'voice' && fields.inputMode !== 'suggestion') {
    throw new HttpError('Input mode must be text, voice, or suggestion', 400);
  }
  if (fields.promptIndex !== undefined && (typeof fields.promptIndex !== 'number' || !Number.isSafeInteger(fields.promptIndex) || fields.promptIndex < 0)) {
    throw new HttpError('Prompt index must be a non-negative integer', 400);
  }

  return {
    message: fields.message.trim(),
    context: fields.context as string | undefined,
    stream: fields.stream as boolean | undefined,
    sessionId: fields.sessionId as string | undefined,
    inputMode: fields.inputMode as ChatRequestPayload['inputMode'],
    promptIndex: fields.promptIndex as number | undefined,
  };
}
