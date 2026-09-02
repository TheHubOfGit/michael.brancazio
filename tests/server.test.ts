import server from '../src/server/index';
import { Env } from '../src/server/types/worker';

async function runTests() {
  console.log('--- Starting Server & Routing Tests ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name}`);
      failed++;
    }
  }

  const mockEnv: Env = {
    GEMINI_API_KEY: 'test-fake-key-123',
    ENVIRONMENT: 'test',
  };

  const mockCtx = {} as ExecutionContext;

  // Test 1: Health Check Endpoint
  {
    const req = new Request('http://localhost/api/health', { method: 'GET' });
    const res = await server.fetch(req, mockEnv, mockCtx);
    const body = (await res.json()) as any;
    assert(res.status === 200, 'Health endpoint returns 200');
    assert(body.status === 'ok', 'Health status is ok');
    assert(body.models.primary === 'gemini-3.5-flash-lite', 'Health primary model is gemini-3.5-flash-lite');
    assert(body.models.fallback === 'gemini-2.5-flash-lite', 'Health fallback model is gemini-2.5-flash-lite');
  }

  // Test 2: CORS Preflight (OPTIONS)
  {
    const req = new Request('http://localhost/api/chat', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://michaelbrancazio-resume.pages.dev',
      },
    });
    const res = await server.fetch(req, mockEnv, mockCtx);
    assert(res.status === 204, 'OPTIONS preflight returns 204');
    assert(
      res.headers.get('Access-Control-Allow-Origin') === 'https://michaelbrancazio-resume.pages.dev',
      'CORS header matches allowed pages.dev domain'
    );
  }

  // Test 3: POST /api/chat with missing body / empty message
  {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    const res = await server.fetch(req, mockEnv, mockCtx);
    const body = (await res.json()) as any;
    assert(res.status === 400, 'Empty message returns 400');
    assert(body.error === 'Message is required', 'Error message is descriptive');
  }

  // Test 4: Missing API Key
  {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });
    const res = await server.fetch(req, { ...mockEnv, GEMINI_API_KEY: '' }, mockCtx);
    const body = (await res.json()) as any;
    assert(res.status === 500, 'Missing API key returns 500');
    assert(body.error === 'API key not configured', 'API key missing message returned');
  }

  // Test 5: Legacy root POST /
  {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });
    const res = await server.fetch(req, mockEnv, mockCtx);
    assert(res.status === 400, 'Legacy root / POST routes to chat handler');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
