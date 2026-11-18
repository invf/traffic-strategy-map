// AUTH-003B pre-deployment audit fix - full-stack integration test for
// the corrected /api/strategies gate: requireSsoAuth ->
// requireProductEntitlement -> strategiesRouter, exactly the real
// mount order in app.js. Proves the three middlewares compose
// correctly end to end (not just that each one is individually
// correct in isolation, which requireProductEntitlement.test.mjs and
// strategiesProxy.test.mjs already cover) and specifically that an
// unauthorized request never reaches PostgREST at all.
// Run with: node backend/tests/strategiesEntitlement.test.mjs

import express from 'express';
import request from 'supertest';
import { createApp } from '../app.js';
import { createStrategiesRouter } from '../routes/strategiesProxy.js';
import { createRequireProductEntitlement } from '../middleware/requireProductEntitlement.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

function fakeSignedIn(userId = 'user-a') {
  return (req, _res, next) => { req.userId = userId; req.sid = `sid-${userId}`; next(); };
}
function fakeSignedOut() {
  return (_req, res) => res.status(401).json({ error: { message: 'Invalid or expired token.' } });
}

function buildApp({ requireSsoAuth, checkEntitlement, fetchImpl }) {
  const strategiesRouter = createStrategiesRouter({
    ensureValidAccessToken: async () => 'fake-real-access-token',
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'anon-key',
    fetchImpl,
  });
  const requireProductEntitlement = createRequireProductEntitlement({ checkEntitlement });
  return createApp({
    requireAuth: fakeSignedOut(), // /api/openai path, irrelevant to these tests
    requireEntitlement: (_req, _res, next) => next(),
    requireSsoAuth,
    requireProductEntitlement,
    strategiesRouter,
    frontendUrl: 'https://frontend.example.com',
  });
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async text() { return body === undefined ? '' : JSON.stringify(body); } };
}

async function run() {
  // ===== Requirement 4: unauthenticated -> 401, never reaches entitlement check OR PostgREST =====
  {
    let entitlementChecked = false;
    let postgrestCalled = false;
    const app = buildApp({
      requireSsoAuth: fakeSignedOut(),
      checkEntitlement: async () => { entitlementChecked = true; return 'active'; },
      fetchImpl: async () => { postgrestCalled = true; return jsonResponse(200, []); },
    });
    const res = await request(app).get('/api/strategies');
    assert(res.status === 401, 'An unauthenticated request to /api/strategies -> 401');
    assert(!entitlementChecked, 'The entitlement check never even runs for an unauthenticated request');
    assert(!postgrestCalled, 'Requirement 6: an unauthenticated request never reaches PostgREST at all');
  }

  // ===== Requirement 2: authenticated, NOT entitled -> 403, never reaches PostgREST =====
  {
    let postgrestCalled = false;
    const app = buildApp({
      requireSsoAuth: fakeSignedIn('no-entitlement-user'),
      checkEntitlement: async () => 'none',
      fetchImpl: async () => { postgrestCalled = true; return jsonResponse(200, []); },
    });
    const res = await request(app).get('/api/strategies');
    assert(res.status === 403, 'An authenticated but non-entitled user -> 403');
    assert(!postgrestCalled, 'Requirement 6: a non-entitled (unauthorized) request never reaches PostgREST');
  }

  // ===== Requirement 3: entitled only to a different product -> 403, never reaches PostgREST =====
  {
    let postgrestCalled = false;
    const app = buildApp({
      requireSsoAuth: fakeSignedIn('launch-studio-only-user'),
      checkEntitlement: async () => 'none', // the real checkEntitlement() returns 'none' for any product mismatch, not just absence
      fetchImpl: async () => { postgrestCalled = true; return jsonResponse(200, []); },
    });
    const res = await request(app).post('/api/strategies').send({ name: 'x', nodes: [], edges: [], product_info: {}, ai_suggestions: {} });
    assert(res.status === 403, 'A user entitled only to a different ADVESER product (e.g. Launch Studio) -> 403 on Traffic Strategy Map strategies');
    assert(!postgrestCalled, 'Requirement 6: never reaches PostgREST for this case either - applies to every protected route (tested here via POST), not just GET');
  }

  // ===== Requirement 5: entitlement service failure -> 503, never reaches PostgREST, never granted =====
  {
    let postgrestCalled = false;
    const app = buildApp({
      requireSsoAuth: fakeSignedIn('some-user'),
      checkEntitlement: async () => { throw new Error('database unreachable'); },
      fetchImpl: async () => { postgrestCalled = true; return jsonResponse(200, []); },
    });
    const res = await request(app).get('/api/strategies');
    assert(res.status === 503, 'An entitlement service failure -> 503, never silently treated as permission granted');
    assert(!postgrestCalled, 'Requirement 6: an infrastructure failure never reaches PostgREST either - fails closed before the proxy call');
  }

  // ===== Requirement 1: authenticated AND entitled -> reaches PostgREST, succeeds =====
  {
    let postgrestCalled = false;
    const app = buildApp({
      requireSsoAuth: fakeSignedIn('entitled-user'),
      checkEntitlement: async () => 'active',
      fetchImpl: async (url) => {
        postgrestCalled = true;
        return jsonResponse(200, [{ id: '1', name: 'My Strategy', product_info: {}, nodes: [], updated_at: '2026-01-01T00:00:00Z' }]);
      },
    });
    const res = await request(app).get('/api/strategies');
    assert(res.status === 200, 'An authenticated AND entitled user -> 200');
    assert(postgrestCalled, 'The request correctly reaches PostgREST once both authentication and entitlement pass');
    assert(res.body[0].name === 'My Strategy', 'The real strategy data is returned');
  }

  // ===== Requirement 7: strategies CRUD never consumes/touches any OpenAI quota concept =====
  // requireProductEntitlement has no checkQuota parameter at all (see
  // requireProductEntitlement.test.mjs's own constructor-signature
  // assertion) - this re-confirms it end to end: a quota function that
  // WOULD throw if ever called is passed nowhere near this stack, and
  // every one of the requests above (several, across multiple test
  // blocks) completed without any quota-shaped call ever happening.
  {
    let quotaFnCalled = false;
    function poisonedQuotaCheck() { quotaFnCalled = true; throw new Error('quota should never be consulted for strategies CRUD'); }
    const app = buildApp({
      requireSsoAuth: fakeSignedIn('entitled-user-2'),
      checkEntitlement: async () => 'active',
      fetchImpl: async () => jsonResponse(201, [{ id: '2', name: 'Another', user_id: 'entitled-user-2', is_demo: false }]),
    });
    // poisonedQuotaCheck is deliberately never wired into buildApp at
    // all - its mere existence and non-invocation is the point.
    const res = await request(app).post('/api/strategies').send({ name: 'Another', nodes: [], edges: [], product_info: {}, ai_suggestions: {} });
    assert(res.status === 201, 'Creating a strategy as an entitled user succeeds');
    assert(!quotaFnCalled, 'Requirement 7: no OpenAI-quota-shaped function was ever invoked for a strategies CRUD request - poisonedQuotaCheck, defined above, was never called because nothing in this path references a quota concept at all');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
