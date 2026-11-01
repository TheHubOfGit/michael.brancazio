import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import server from '../src/server/index';
import { CONFIG } from '../src/server/config';
import { Env } from '../src/server/types/worker';
import { callGemini, callGeminiStream, GeminiServiceError } from '../src/server/services/gemini';
import { createRateLimiter } from '../src/server/middleware/rateLimit';
import { bridgeWebSockets } from '../src/server/routes/liveWs';
import { buildSystemPrompt } from '../src/server/services/contextEngine';

const env: Env = { GEMINI_API_KEY: 'fake-api-key-for-tests', ENVIRONMENT: 'test' };
const ctx = { waitUntil: () => undefined } as ExecutionContext;
let clientNumber = 0;
function request(body: unknown, options: RequestInit = {}, path = '/api/chat'): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST', body: JSON.stringify(body), ...options,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `192.0.2.${++clientNumber}`, ...options.headers },
  });
}
function providerResponse(parts: unknown[] = [{ text: 'A useful answer.' }]) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts } }] }), { headers: { 'Content-Type': 'application/json' } });
}
const options = { message: 'Tell me about Michael', apiKey: env.GEMINI_API_KEY! };

for (const path of ['/api/health', '/health', '/status']) {
  test(`health alias ${path} reports configuration and models`, async () => {
    const response = await server.fetch(new Request(`http://localhost${path}`), env, ctx);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.configured, true);
    assert.deepEqual(body.models, { primary: CONFIG.MODELS.PRIMARY, fallback: CONFIG.MODELS.FALLBACK });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  });
}

test('HEAD health has headers and no response body; whitespace key is unconfigured', async () => {
  const response = await server.fetch(new Request('http://localhost/health', { method: 'HEAD' }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  const noKey = await server.fetch(new Request('http://localhost/health'), { GEMINI_API_KEY: '  ' }, ctx);
  assert.equal((await noKey.json()).configured, false);
});

for (const origin of ['https://michaelbrancazio-resume.pages.dev', 'https://abc123.michaelbrancazio-resume.pages.dev', 'https://feature-a.michaelbrancazio.pages.dev']) {
  test(`CORS permits portfolio origin ${origin}`, async () => {
    const response = await server.fetch(new Request('http://localhost/api/chat', { method: 'OPTIONS', headers: { Origin: origin } }), env, ctx);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Vary'), 'Origin');
  });
}

for (const origin of ['https://unrelated.pages.dev', 'https://michaelbrancazio-resume.pages.dev.evil.example', 'null']) {
  test(`CORS rejects untrusted origin ${origin} before provider calls`, async () => {
    const response = await server.fetch(request({ message: 'Hello' }, { headers: { Origin: origin } }), env, ctx);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    const preflight = await server.fetch(new Request('http://localhost/api/chat', { method: 'OPTIONS', headers: { Origin: origin } }), env, ctx);
    assert.equal(preflight.status, 403);
  });
}

test('configured origins work on JSON responses and failed requests', async () => {
  const origin = 'https://portfolio.example';
  const response = await server.fetch(request({ message: '' }, { headers: { Origin: origin } }), { ...env, ALLOWED_ORIGINS: ` https://other.example, ${origin} ` }, ctx);
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});

test('known routes enforce methods and live handshake requirements', async () => {
  for (const [path, method, status, allow] of [
    ['/api/health', 'POST', 405, 'GET, HEAD, OPTIONS'],
    ['/api/chat', 'GET', 405, 'POST, OPTIONS'],
    ['/api/live', 'POST', 405, 'GET, OPTIONS'],
    ['/api/live', 'GET', 426, null],
    ['/unknown', 'DELETE', 404, null],
  ] as const) {
    const response = await server.fetch(new Request(`http://localhost${path}`, { method }), env, ctx);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Allow'), allow);
  }
  const unexpectedUpgrade = await server.fetch(new Request('http://localhost/unknown', { headers: { Upgrade: 'websocket' } }), env, ctx);
  assert.equal(unexpectedUpgrade.status, 404);
});

test('root legacy POST and WebSocket aliases remain supported', async () => {
  const response = await server.fetch(request({ message: '' }, {}, '/'), env, ctx);
  assert.equal(response.status, 400);
  const websocket = await server.fetch(new Request('http://localhost/', { headers: { Upgrade: 'WebSocket' } }), {}, ctx);
  assert.equal(websocket.status, 500);
  assert.equal((await websocket.json()).error, 'API key not configured');
});

for (const [label, body] of [
  ['null JSON', null], ['array JSON', []], ['scalar JSON', 42], ['empty message', { message: '  ' }],
  ['numeric message', { message: 123 }], ['long message', { message: 'a'.repeat(5001) }],
  ['object context', { message: 'Hello', context: {} }], ['long context', { message: 'Hello', context: 'a'.repeat(40001) }],
  ['string stream', { message: 'Hello', stream: 'false' }], ['object session', { message: 'Hello', sessionId: {} }],
  ['long session', { message: 'Hello', sessionId: 'a'.repeat(129) }], ['invalid input mode', { message: 'Hello', inputMode: 'bad' }],
  ['negative prompt index', { message: 'Hello', promptIndex: -1 }], ['fractional prompt index', { message: 'Hello', promptIndex: 1.5 }],
] as const) {
  test(`payload validation rejects ${label}`, async () => {
    const response = await server.fetch(request(body), env, ctx);
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, 'string');
  });
}

test('invalid JSON and unsupported content types produce client errors', async () => {
  const invalid = await server.fetch(request(undefined, { body: '{' }), env, ctx);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'Invalid JSON body');
  const plain = await server.fetch(request({ message: 'Hello' }, { headers: { 'Content-Type': 'text/plain' } }), env, ctx);
  assert.equal(plain.status, 415);
});

test('request byte limit rejects both declared and undeclared oversized bodies', async () => {
  const declared = await server.fetch(request({ message: 'Hello' }, { headers: { 'Content-Length': '1000000' } }), env, ctx);
  assert.equal(declared.status, 413);
  const undeclared = await server.fetch(request({ message: 'Hello', unknownField: 'x'.repeat(CONFIG.LIMITS.REQUEST_BYTES) }), env, ctx);
  assert.equal(undeclared.status, 413);
  const unicode = await server.fetch(request({ message: 'Hello', context: '😀'.repeat(18000) }), env, ctx);
  assert.equal(unicode.status, 413);
});

test('missing API key remains a descriptive server configuration error', async () => {
  const response = await server.fetch(request({ message: 'Hello' }), { GEMINI_API_KEY: '' }, ctx);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'API key not configured');
});

test('provider uses separate system instructions and credentials header, joining visible text parts', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(!String(url).includes(env.GEMINI_API_KEY!));
    assert.equal(new Headers(init.headers).get('x-goog-api-key'), env.GEMINI_API_KEY);
    const payload = JSON.parse(init.body);
    assert.equal(payload.systemInstruction.parts[0].text, buildSystemPrompt());
    assert.equal(payload.contents[0].role, 'user');
    assert.ok(payload.contents[0].parts[0].text.includes('Portfolio context'));
    assert.ok(!payload.systemInstruction.parts[0].text.includes('Untrusted client instructions'));
    return providerResponse([{ text: 'Internal reasoning', thought: true }, { text: 'Hello ' }, { text: 'there.' }]);
  });
  const result = await callGemini({ ...options, context: 'Untrusted client instructions' });
  assert.equal(result.text, 'Hello there.');
  assert.equal(result.modelUsed, CONFIG.MODELS.PRIMARY);
});

test('provider fallback handles exhausted network retries', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls++;
    if (String(url).includes(CONFIG.MODELS.PRIMARY)) throw new Error('private provider detail');
    return providerResponse();
  });
  const result = await callGemini(options);
  assert.equal(result.modelUsed, CONFIG.MODELS.FALLBACK);
  assert.equal(calls, 3);
});

test('provider releases rejected response bodies before retry and fallback', async (t) => {
  let cancelled = 0;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls < 3 ? new Response(new ReadableStream({ cancel: () => { cancelled++; } }), { status: 503 }) : providerResponse();
  });
  const result = await callGemini(options);
  assert.equal(result.modelUsed, CONFIG.MODELS.FALLBACK);
  assert.equal(cancelled, 2);
});

test('authentication failures avoid redundant fallback and never expose provider secrets', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('private token and internal error', { status: 403 }); });
  const response = await server.fetch(request({ message: 'Hello' }), env, ctx);
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { error: 'Failed to get response from AI service' });
});

test('malformed or empty provider responses try fallback instead of returning fabricated success', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? providerResponse([]) : providerResponse());
  assert.equal((await callGemini(options)).modelUsed, CONFIG.MODELS.FALLBACK);
});

test('provider response buffering has an enforced byte limit', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(CONFIG.LIMITS.PROVIDER_RESPONSE_BYTES + 1)));
  await assert.rejects(callGemini(options), (error) => error instanceof GeminiServiceError && error.status === 502);
});

test('provider timeouts abort both model attempts and surface HTTP 504', async (t) => {
  const nativeTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, duration, ...args) => nativeTimeout(callback, duration === CONFIG.LIMITS.PROVIDER_TIMEOUT_MS ? 1 : duration, ...args));
  let aborted = 0;
  t.mock.method(globalThis, 'fetch', (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted++; reject(new Error('aborted')); }, { once: true });
  }));
  const response = await server.fetch(request({ message: 'Hello' }), env, ctx);
  assert.equal(response.status, 504);
  assert.equal(aborted, 2);
});

test('client cancellation stops provider work without fallback', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return providerResponse(); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(callGemini({ ...options, signal: controller.signal }), (error) => error instanceof GeminiServiceError && error.status === 499);
  assert.equal(calls, 0);
});

test('streaming recovers from primary network failure and preserves SSE payloads', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes(CONFIG.MODELS.PRIMARY)) throw new Error('connection refused');
    return new Response('data: {"text":"hello"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const response = await server.fetch(request({ message: 'Hello', stream: true }), env, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Model-Used'), CONFIG.MODELS.FALLBACK);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(await response.text(), 'data: {"text":"hello"}\n\n');
});

test('stream cancellation releases the upstream body', async (t) => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel: () => { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const result = await callGeminiStream(options);
  await result.stream.cancel();
  assert.equal(cancelled, true);
});

test('stalled SSE streams expire and cancel their upstream reader', async (t) => {
  const nativeTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, duration, ...args) => nativeTimeout(callback, duration === CONFIG.LIMITS.STREAM_TIMEOUT_MS ? 1 : duration, ...args));
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ cancel: () => { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
  const result = await callGeminiStream(options);
  await assert.rejects(new Response(result.stream).text(), (error) => error instanceof GeminiServiceError && error.status === 504);
  assert.equal(cancelled, true);
});

test('streaming rejects non-SSE upstream responses and sanitizes errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('secret upstream HTML', { headers: { 'Content-Type': 'text/html' } }));
  const response = await server.fetch(request({ message: 'Hello', stream: true }), env, ctx);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Failed to get response from AI service' });
});

test('D1 audit preserves prompt index zero and writes outside the response path', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => providerResponse());
  const pending: Promise<unknown>[] = [];
  let values: unknown[] = [];
  const database = { prepare: () => ({ bind: (...args: unknown[]) => { values = args; return { run: async () => ({ success: true }) }; } }) } as unknown as D1Database;
  const context = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;
  const response = await server.fetch(request({ message: 'Hello', promptIndex: 0 }), { ...env, DB: database }, context);
  assert.equal(response.status, 200);
  await Promise.all(pending);
  assert.equal(values[4], 0);
});

test('synchronous D1 binding failures cannot turn a successful answer into an error', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => providerResponse());
  const pending: Promise<unknown>[] = [];
  const database = { prepare: () => { throw new Error('missing table'); } } as unknown as D1Database;
  const context = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;
  const response = await server.fetch(request({ message: 'Hello' }), { ...env, DB: database }, context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).response, 'A useful answer.');
  await Promise.all(pending);
});

test('rate limiter enforces burst, refills predictably, and ignores spoofed forwarding headers', () => {
  let now = 0;
  const limit = createRateLimiter(() => now);
  for (let index = 0; index < 10; index++) assert.equal(limit(new Request('http://localhost', { headers: { 'X-Forwarded-For': `fake-${index}` } })).allowed, true);
  assert.equal(limit(new Request('http://localhost', { headers: { 'X-Forwarded-For': 'another-ip' } })).allowed, false);
  now = 1500;
  assert.equal(limit(new Request('http://localhost')).allowed, true);
  assert.equal(limit(new Request('http://localhost')).allowed, false);
});

test('rate limiter enforces a minute quota in addition to burst capacity', () => {
  let now = 0;
  const limit = createRateLimiter(() => now);
  const req = new Request('http://localhost');
  for (let index = 0; index < 40; index++) { now = index * 1500; assert.equal(limit(req).allowed, true); }
  now = 59_000;
  const result = limit(req);
  assert.equal(result.allowed, false);
  assert.equal(result.reset, 1);
  now = 60_000;
  assert.equal(limit(req).allowed, true);
});

test('rate limiter bounds tracked clients and frees idle capacity', () => {
  let now = 0;
  const limit = createRateLimiter(() => now, 2);
  assert.equal(limit(request({})).allowed, true);
  assert.equal(limit(request({})).allowed, true);
  assert.equal(limit(request({})).allowed, false);
  now = 60_000;
  assert.equal(limit(request({})).allowed, true);
});

test('rate-limited requests publish machine-readable retry headers', async () => {
  const headers = { 'CF-Connecting-IP': '198.51.100.200' };
  for (let index = 0; index < 10; index++) await server.fetch(request({ message: '' }, { headers }), env, ctx);
  const response = await server.fetch(request({ message: '' }, { headers }), env, ctx);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.equal(response.headers.get('X-RateLimit-Remaining'), '0');
});

class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState: number;
  sent: unknown[] = [];
  closes: { code?: number; reason?: string }[] = [];
  constructor(state = FakeSocket.CONNECTING) { super(); this.readyState = state; }
  send(data: unknown) { this.sent.push(data); }
  close(code?: number, reason?: string) { this.closes.push({ code, reason }); this.readyState = FakeSocket.CLOSED; }
  emit(type: string, fields: object = {}) { this.dispatchEvent(Object.assign(new Event(type), fields)); }
}
function sockets(t: TestContext) {
  t.mock.method(globalThis, 'WebSocket', FakeSocket);
  const server = new FakeSocket(FakeSocket.OPEN);
  const upstream = new FakeSocket();
  let closed = 0;
  const stop = bridgeWebSockets(server as unknown as WebSocket, upstream as unknown as WebSocket, () => { closed++; });
  t.after(stop);
  return { server, upstream, get closed() { return closed; } };
}

test('voice bridge flushes buffered messages in order and forwards both directions', (t) => {
  const { server, upstream } = sockets(t);
  server.emit('message', { data: 'setup' });
  server.emit('message', { data: 'audio' });
  assert.deepEqual(upstream.sent, []);
  upstream.readyState = FakeSocket.OPEN;
  upstream.emit('open');
  assert.deepEqual(upstream.sent, ['setup', 'audio']);
  upstream.emit('message', { data: 'reply' });
  assert.deepEqual(server.sent, ['reply']);
});

test('voice bridge normalizes reserved close codes and closes both peers once', (t) => {
  const bridge = sockets(t);
  bridge.upstream.emit('close', { code: 1006, reason: 'private provider detail' });
  bridge.server.emit('close', { code: 1000 });
  assert.equal(bridge.server.closes[0].code, 1011);
  assert.ok(!bridge.server.closes[0].reason?.includes('private'));
  assert.equal(bridge.upstream.closes.length, 1);
  assert.equal(bridge.closed, 1);
});

test('voice bridge rejects oversized frames and pre-connect buffer overflow', (t) => {
  const first = sockets(t);
  first.server.emit('message', { data: 'x'.repeat(CONFIG.LIMITS.LIVE_MESSAGE_BYTES + 1) });
  assert.equal(first.server.closes[0].code, 1009);
  const second = sockets(t);
  for (let index = 0; index <= CONFIG.LIMITS.LIVE_BUFFER_MESSAGES; index++) second.server.emit('message', { data: 'a' });
  assert.equal(second.server.closes[0].code, 1009);
});

test('voice bridge bounds total queued bytes as well as frame count', (t) => {
  const { server } = sockets(t);
  for (let index = 0; index < 5; index++) server.emit('message', { data: new ArrayBuffer(CONFIG.LIMITS.LIVE_MESSAGE_BYTES) });
  assert.equal(server.closes[0].code, 1009);
});

test('voice bridge expires stalled upstream connections', async (t) => {
  const nativeTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, duration, ...args) => nativeTimeout(callback, duration === CONFIG.LIMITS.LIVE_CONNECT_TIMEOUT_MS ? 1 : duration, ...args));
  const { server, upstream } = sockets(t);
  await new Promise((resolve) => nativeTimeout(resolve, 5));
  assert.equal(server.closes[0].code, 1013);
  assert.equal(upstream.readyState, FakeSocket.CLOSED);
});

test('voice bridge catches send failures and terminates the session', (t) => {
  const { server, upstream } = sockets(t);
  upstream.readyState = FakeSocket.OPEN;
  upstream.emit('open');
  t.mock.method(upstream, 'send', () => { throw new Error('socket disappeared'); });
  server.emit('message', { data: 'audio' });
  assert.equal(server.closes[0].code, 1011);
  assert.equal(upstream.readyState, FakeSocket.CLOSED);
});

test('voice bridge errors close both sockets and discard queued messages', (t) => {
  const { server, upstream } = sockets(t);
  server.emit('message', { data: 'setup' });
  upstream.emit('error');
  upstream.readyState = FakeSocket.OPEN;
  upstream.emit('open');
  assert.equal(server.closes[0].code, 1011);
  assert.deepEqual(upstream.sent, []);
  assert.equal(upstream.readyState, FakeSocket.CLOSED);
});
