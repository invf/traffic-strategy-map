// AUTH-003A - end-to-end route test (real Express, real supertest HTTP
// requests, injected fakes for auth/entitlement/OpenAI/usage-logging) -
// proves the full request path, not just each middleware in isolation.
// In particular: that usage is logged AFTER the OpenAI call resolves,
// with the real outcome, not merely on attempt; that a failed OpenAI
// call or missing API key still logs something distinguishable; and
// that an invalid token can never reach the OpenAI call at all.
//
// Run with: node backend/tests/app.test.mjs

import request from 'supertest';
import { createApp } from '../app.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`[PASS] ${message}`);
  } else {
    failed++;
    console.error(`[FAIL] ${message}`);
  }
}

function alwaysAuth(userId = 'user-x') {
  return (req, _res, next) => { req.userId = userId; next(); };
}
function rejectAuth() {
  return (_req, res) => res.status(401).json({ error: { message: 'Invalid or expired token.' } });
}
function alwaysEntitled() {
  return (_req, _res, next) => next();
}

async function run() {
  // ===== A successful OpenAI call logs usage AFTER it resolves, status "success" =====
  {
    const usageCalls = [];
    const app = createApp({
      requireAuth: alwaysAuth('user-a'),
      requireEntitlement: alwaysEntitled(),
      openaiApiKey: 'fake-key',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }),
      recordUsage: async (userId, meta) => { usageCalls.push({ userId, meta }); },
    });

    const res = await request(app).post('/api/openai').send({ messages: [] });
    assert(res.status === 200, 'A successful upstream call returns 200 to the client');
    await new Promise((r) => setTimeout(r, 20)); // let the fire-and-forget usage log settle
    assert(usageCalls.length === 1, 'Usage was logged exactly once, after the call resolved');
    assert(usageCalls[0].userId === 'user-a' && usageCalls[0].meta.status === 'success' && usageCalls[0].meta.upstreamStatus === 200, "The log reflects the REAL outcome ('success', upstream 200) - not merely that a request was attempted");
  }

  // ===== An upstream OpenAI error is logged distinctly from a success, but still returned to the client =====
  {
    const usageCalls = [];
    const app = createApp({
      requireAuth: alwaysAuth('user-b'),
      requireEntitlement: alwaysEntitled(),
      openaiApiKey: 'fake-key',
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited upstream' } }) }),
      recordUsage: async (userId, meta) => { usageCalls.push({ userId, meta }); },
    });

    const res = await request(app).post('/api/openai').send({ messages: [] });
    assert(res.status === 429, "The client sees OpenAI's own real status code, passed through");
    await new Promise((r) => setTimeout(r, 20));
    assert(usageCalls[0].meta.status === 'upstream_error' && usageCalls[0].meta.upstreamStatus === 429, "The log distinguishes an upstream failure ('upstream_error', 429) from a success - this is the entire point of logging AFTER the call, not before");
  }

  // ===== A network-level failure (fetch itself throws) is logged as request_failed, never crashes =====
  {
    const usageCalls = [];
    const app = createApp({
      requireAuth: alwaysAuth('user-c'),
      requireEntitlement: alwaysEntitled(),
      openaiApiKey: 'fake-key',
      fetchImpl: async () => { throw new Error('ENOTFOUND api.openai.com'); },
      recordUsage: async (userId, meta) => { usageCalls.push({ userId, meta }); },
    });

    const res = await request(app).post('/api/openai').send({ messages: [] });
    assert(res.status === 500, 'A network-level failure is reported as 500, not left to crash the process');
    assert(!JSON.stringify(res.body).includes('fake-key'), 'The API key never appears anywhere in the error response');
    await new Promise((r) => setTimeout(r, 20));
    assert(usageCalls[0].meta.status === 'request_failed', "Logged as 'request_failed', distinct from both 'success' and 'upstream_error'");
  }

  // ===== Missing OPENAI_API_KEY: logged as not_configured, OpenAI is never actually called =====
  {
    const usageCalls = [];
    let fetchCalled = false;
    const app = createApp({
      requireAuth: alwaysAuth('user-d'),
      requireEntitlement: alwaysEntitled(),
      openaiApiKey: undefined,
      fetchImpl: async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) }; },
      recordUsage: async (userId, meta) => { usageCalls.push({ userId, meta }); },
    });

    const res = await request(app).post('/api/openai').send({ messages: [] });
    assert(res.status === 500, 'A missing API key is a clean 500');
    assert(!fetchCalled, 'OpenAI is never actually called when the key is missing');
    await new Promise((r) => setTimeout(r, 20));
    assert(usageCalls[0].meta.status === 'not_configured', "Logged distinctly as 'not_configured', not conflated with a real request_failed or upstream_error");
  }

  // ===== An invalid/rejected auth never reaches OpenAI at all =====
  {
    let fetchCalled = false;
    const app = createApp({
      requireAuth: rejectAuth(),
      requireEntitlement: alwaysEntitled(),
      openaiApiKey: 'fake-key',
      fetchImpl: async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({}) }; },
      recordUsage: async () => {},
    });

    const res = await request(app).post('/api/openai').send({ messages: [] });
    assert(res.status === 401, 'A rejected auth check returns 401');
    assert(!fetchCalled, 'OpenAI is NEVER called when auth fails - the route handler never runs at all');
  }

  // ===== A failing recordUsage never affects the response the client already received =====
  {
    const app = createApp({
      requireAuth: alwaysAuth('user-e'),
      requireEntitlement: alwaysEntitled(),
      openaiApiKey: 'fake-key',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }),
      recordUsage: async () => { throw new Error('usage table unreachable'); },
    });

    const res = await request(app).post('/api/openai').send({ messages: [] });
    assert(res.status === 200, 'A failing usage log never changes the response the client already got - it is purely observability, never load-bearing');
  }

  // ===== AUTH-003B same-origin proxy audit: /api and /auth responses are never cacheable =====
  // A response proxied through Vercel's external-origin rewrite could
  // be cached by its CDN if it carries caching headers (or, per
  // Vercel's own ambiguity, possibly if it carries none at all) - for
  // auth-bearing, per-user routes (a Set-Cookie response especially),
  // a single cached response served to a different visitor would be a
  // session-hijack-shaped bug. no-store must be explicit, not implied
  // by the absence of any other header.
  {
    const app = createApp({
      requireAuth: alwaysAuth('user-f'),
      requireEntitlement: alwaysEntitled(),
      openaiApiKey: 'fake-key',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }),
      recordUsage: async () => {},
    });
    const res = await request(app).post('/api/openai').send({ messages: [] });
    assert(res.headers['cache-control'] === 'no-store', '/api/openai responses carry Cache-Control: no-store - never cacheable by an external-origin proxy CDN');
  }
  {
    const app = createApp({ requireAuth: alwaysAuth(), requireEntitlement: alwaysEntitled() });
    const res = await request(app).get('/health');
    assert(res.headers['cache-control'] === undefined, '/health (not under /api or /auth) is unaffected - this is scoped, not a blanket no-store on every route');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
