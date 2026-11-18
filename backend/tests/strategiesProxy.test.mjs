// AUTH-003B - backend/routes/strategiesProxy.js: proves the proxy
// relays public.strategies CRUD to PostgREST using the CALLING user's
// own real (cached/refreshed) access token - never a shared app key -
// and that user_id on insert always comes from the verified session,
// never from the request body. A fake fetchImpl stands in for
// PostgREST so these assertions run with no real Supabase project.
//
// Run with: node backend/tests/strategiesProxy.test.mjs

import express from 'express';
import request from 'supertest';
import { createStrategiesRouter } from '../routes/strategiesProxy.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

function fakeSessionMiddleware(userId = 'user-a', sid = 'sid-a') {
  return (req, _res, next) => { req.userId = userId; req.sid = sid; next(); };
}

function buildApp({ ensureValidAccessToken, fetchImpl, userId, sid }) {
  const app = express();
  app.use(express.json());
  app.use(fakeSessionMiddleware(userId, sid));
  app.use(createStrategiesRouter({
    ensureValidAccessToken,
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'anon-key-value',
    fetchImpl,
  }));
  return app;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return body === undefined ? '' : JSON.stringify(body); },
  };
}

async function run() {
  // ===== Constructor guards =====
  {
    let threw = false;
    try { createStrategiesRouter({ supabaseUrl: 'x', supabaseAnonKey: 'y' }); } catch { threw = true; }
    assert(threw, 'createStrategiesRouter throws without ensureValidAccessToken');
  }
  {
    let threw = false;
    try { createStrategiesRouter({ ensureValidAccessToken: async () => 't', supabaseAnonKey: 'y' }); } catch { threw = true; }
    assert(threw, 'createStrategiesRouter throws without supabaseUrl');
  }
  {
    let threw = false;
    try { createStrategiesRouter({ ensureValidAccessToken: async () => 't', supabaseUrl: 'x' }); } catch { threw = true; }
    assert(threw, 'createStrategiesRouter throws without supabaseAnonKey');
  }

  // ===== No valid access token -> 401, PostgREST never called =====
  {
    let fetchCalled = false;
    const app = buildApp({
      ensureValidAccessToken: async () => null,
      fetchImpl: async () => { fetchCalled = true; return jsonResponse(200, []); },
    });
    const res = await request(app).get('/api/strategies');
    assert(res.status === 401, 'GET /api/strategies with no valid access token -> 401');
    assert(!fetchCalled, 'PostgREST is never called when the access token could not be established');
  }

  // ===== GET /api/strategies - correct PostgREST query, correct headers =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async (sid) => { assert(sid === 'sid-a', 'ensureValidAccessToken is called with THIS request\'s sid'); return 'real-access-token'; },
      fetchImpl: async (url, init) => {
        captured = { url: new URL(url), init };
        return jsonResponse(200, [{ id: '1', name: 'Demo', product_info: {}, nodes: [], updated_at: '2026-01-01T00:00:00Z' }]);
      },
    });
    const res = await request(app).get('/api/strategies');
    assert(res.status === 200, 'GET /api/strategies -> 200');
    assert(Array.isArray(res.body) && res.body.length === 1, 'Returns the list PostgREST returned');
    assert(captured.url.pathname === '/rest/v1/strategies', 'Requests the correct PostgREST table path');
    assert(captured.url.searchParams.get('select') === 'id,name,product_info,nodes,updated_at', 'Requests only the list columns, never nodes/edges/ai_suggestions in full');
    assert(captured.url.searchParams.get('order') === 'updated_at.desc', 'Orders by updated_at descending');
    assert(captured.init.headers.Authorization === 'Bearer real-access-token', 'Uses the real per-user access token as the Bearer credential, not a shared key');
    assert(captured.init.headers.apikey === 'anon-key-value', 'Sends the project anon key as the apikey header (required by PostgREST), never a service key');
  }

  // ===== GET /api/strategies/:id - single-object query =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url, init) => {
        captured = new URL(url);
        return jsonResponse(200, { id: 'abc', name: 'Full', nodes: [], edges: [], product_info: {}, ai_suggestions: {} });
      },
    });
    const res = await request(app).get('/api/strategies/abc');
    assert(res.status === 200 && res.body.id === 'abc', 'GET /api/strategies/:id returns the full row');
    assert(captured.searchParams.get('id') === 'eq.abc', 'Filters by the exact requested id');
    assert(captured.searchParams.get('select') === '*', 'Requests all columns for the single-row view');
  }

  // ===== GET /api/strategies/:id - not found =====
  {
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async () => jsonResponse(200, undefined),
    });
    const res = await request(app).get('/api/strategies/missing');
    assert(res.status === 404, 'GET /api/strategies/:id for a nonexistent (or not-owned/not-demo, RLS-invisible) row -> 404, not a crash');
  }

  // ===== POST /api/strategies - user_id always comes from the verified session =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      userId: 'the-real-user',
      fetchImpl: async (url, init) => {
        captured = JSON.parse(init.body);
        return jsonResponse(201, [{ id: 'new-id', ...captured }]);
      },
    });
    const res = await request(app)
      .post('/api/strategies')
      .send({ name: 'My Plan', nodes: [1], edges: [], product_info: { name: 'P' }, ai_suggestions: {}, user_id: 'someone-elses-id' });
    assert(res.status === 201, 'POST /api/strategies -> 201');
    assert(captured.user_id === 'the-real-user', 'user_id sent to PostgREST is the VERIFIED session user, overriding whatever the client sent in the body');
    assert(captured.is_demo === false, 'A regular authenticated insert is never marked as a demo row');
    assert(res.body.id === 'new-id', 'Returns the inserted row (including its generated id)');
  }

  // ===== PATCH /api/strategies/:id - partial update, only provided fields =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url, init) => {
        captured = JSON.parse(init.body);
        return jsonResponse(200, [{ id: 'abc', name: captured.name }]);
      },
    });
    const res = await request(app).patch('/api/strategies/abc').send({ name: 'Renamed' });
    assert(res.status === 200 && res.body.name === 'Renamed', 'PATCH /api/strategies/:id updates and returns the row');
    assert(!('nodes' in captured) && !('edges' in captured), 'Fields the client did not send are never included in the PATCH body');
    assert('updated_at' in captured, 'updated_at is always refreshed on a PATCH');
  }

  // ===== PATCH /api/strategies/:id - not found/not owned =====
  {
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async () => jsonResponse(200, []),
    });
    const res = await request(app).patch('/api/strategies/not-mine').send({ name: 'x' });
    assert(res.status === 404, 'PATCH on a row RLS makes invisible (not owned, not found) -> 404, not a silent no-op success');
  }

  // ===== DELETE /api/strategies/:id =====
  {
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async () => jsonResponse(200, [{ id: 'abc' }]),
    });
    const res = await request(app).delete('/api/strategies/abc');
    assert(res.status === 204, 'DELETE /api/strategies/:id -> 204 on success');
  }

  // ===== DELETE /api/strategies/:id - not found/not owned =====
  {
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async () => jsonResponse(200, []),
    });
    const res = await request(app).delete('/api/strategies/not-mine');
    assert(res.status === 404, 'DELETE on a row RLS makes invisible -> 404, never reported as a successful delete');
  }

  // ===== PostgREST rejects the request (e.g. RLS WITH CHECK failure) =====
  {
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async () => jsonResponse(403, { message: 'new row violates row-level security policy' }),
    });
    const res = await request(app)
      .post('/api/strategies')
      .send({ name: 'x', nodes: [], edges: [], product_info: {}, ai_suggestions: {} });
    assert(res.status === 403, 'A PostgREST/RLS rejection is relayed with its real status, not swallowed into a generic 500');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
