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

  // ===== GET /api/strategies/:id - single-row query, array-based (not the singular-object Accept header) =====
  {
    let captured;
    let capturedHeaders;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url, init) => {
        captured = new URL(url);
        capturedHeaders = init.headers;
        return jsonResponse(200, [{ id: 'abc', name: 'Full', nodes: [], edges: [], product_info: {}, ai_suggestions: {} }]);
      },
    });
    const res = await request(app).get('/api/strategies/abc');
    assert(res.status === 200 && res.body.id === 'abc', 'GET /api/strategies/:id returns the full row (unwrapped from the array PostgREST returns)');
    assert(captured.searchParams.get('id') === 'eq.abc', 'Filters by the exact requested id');
    assert(captured.searchParams.get('select') === '*', 'Requests all columns for the single-row view');
    assert(!capturedHeaders?.Accept, "Pre-production audit fix: no singular-object Accept header - a REAL PostgREST returns a 406 error (not 200+null) for that header when 0 rows match, which this app's rehearsal_strategies_proxy.mjs caught against a real local stack");
  }

  // ===== GET /api/strategies/:id - not found (0 rows in the array, not a null/missing body) =====
  {
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async () => jsonResponse(200, []),
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
    assert(!('project_id' in captured) && !('source_launch_analysis_id' in captured), 'ADV-004: omitting project_id/source_launch_analysis_id keeps the PATCH body byte-identical to before this change - no regression for any existing caller');
    assert('updated_at' in captured, 'updated_at is always refreshed on a PATCH');
  }

  // ===== POST /api/strategies - ADV-004: optional project_id/source_launch_analysis_id, only when the caller actually sends them =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url, init) => {
        captured = JSON.parse(init.body);
        return jsonResponse(201, [{ id: 'new-id', ...captured }]);
      },
    });
    const res = await request(app)
      .post('/api/strategies')
      .send({ name: 'Imported Strategy', nodes: [], edges: [], project_id: 'proj-1', source_launch_analysis_id: 'export-1' });
    assert(res.status === 201, 'POST /api/strategies with project_id/source_launch_analysis_id -> 201');
    assert(captured.project_id === 'proj-1' && captured.source_launch_analysis_id === 'export-1', 'Both ADV-004 fields are sent through to PostgREST exactly as provided');
  }

  // ===== PATCH /api/strategies/:id - ADV-004: re-pointing an existing strategy at a NEWER export on re-import =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url, init) => {
        captured = JSON.parse(init.body);
        return jsonResponse(200, [{ id: 'abc', ...captured }]);
      },
    });
    const res = await request(app).patch('/api/strategies/abc').send({ source_launch_analysis_id: 'export-2' });
    assert(res.status === 200, 'PATCH /api/strategies/:id with a new source_launch_analysis_id -> 200');
    assert(captured.source_launch_analysis_id === 'export-2', 'The SAME row is updated in place with the new export link - never a second row');
    assert(!('project_id' in captured), 'project_id is left untouched when the caller only re-points the export link');
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

  // ===== AUTH-004: PATCH with expected_updated_at - matching value succeeds, and IS included as a second filter =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url, init) => {
        captured = new URL(url);
        return jsonResponse(200, [{ id: 'abc', name: 'Renamed' }]);
      },
    });
    const res = await request(app)
      .patch('/api/strategies/abc')
      .send({ name: 'Renamed', expected_updated_at: '2026-01-01T00:00:00Z' });
    assert(res.status === 200, 'PATCH with a matching expected_updated_at succeeds exactly like an unconditional PATCH');
    assert(captured.searchParams.get('id') === 'eq.abc', 'id filter is still present');
    assert(captured.searchParams.get('updated_at') === 'eq.2026-01-01T00:00:00Z', 'expected_updated_at is sent to PostgREST as a SECOND filter, ANDed with id - a real conditional update, not a client-side check');
  }

  // ===== AUTH-004: PATCH with expected_updated_at omitted - byte-identical to before this change (regression guard) =====
  {
    let captured;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url) => {
        captured = new URL(url);
        return jsonResponse(200, [{ id: 'abc', name: 'Renamed' }]);
      },
    });
    const res = await request(app).patch('/api/strategies/abc').send({ name: 'Renamed' });
    assert(res.status === 200, 'Omitting expected_updated_at still succeeds');
    assert(!captured.searchParams.has('updated_at'), 'No updated_at filter is added when expected_updated_at is not sent - unconditional update, unchanged from before this feature');
  }

  // ===== AUTH-004: PATCH with a STALE expected_updated_at, row exists -> 409 with the server's current row =====
  {
    let call = 0;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async (url, init) => {
        call += 1;
        if (call === 1) {
          // The conditional PATCH itself: id+updated_at filter matches nothing (someone else already changed it).
          assert(init.method === 'PATCH', 'First call is the conditional PATCH');
          return jsonResponse(200, []);
        }
        // The disambiguation GET: unconditional by id, proves the row DOES exist/is visible.
        assert(init.method === 'GET', 'Second call (only on an empty conditional PATCH result) is a plain GET by id, to disambiguate 404 vs 409');
        return jsonResponse(200, [{ id: 'abc', name: 'Changed by someone else', updated_at: '2026-01-02T00:00:00Z' }]);
      },
    });
    const res = await request(app)
      .patch('/api/strategies/abc')
      .send({ name: 'My stale edit', expected_updated_at: '2026-01-01T00:00:00Z' });
    assert(res.status === 409, 'A stale expected_updated_at against a row that still exists/is visible -> 409, never a silent overwrite and never a plain 404');
    assert(res.body.current?.id === 'abc' && res.body.current?.updated_at === '2026-01-02T00:00:00Z', 'The 409 body carries the server\'s CURRENT row, so the frontend can show what actually changed');
  }

  // ===== AUTH-004: PATCH with a STALE expected_updated_at, row does NOT exist/is not visible -> 404, not 409 =====
  {
    let call = 0;
    const app = buildApp({
      ensureValidAccessToken: async () => 'tok',
      fetchImpl: async () => {
        call += 1;
        return jsonResponse(200, []); // both the conditional PATCH and the disambiguation GET come back empty
      },
    });
    const res = await request(app)
      .patch('/api/strategies/not-mine')
      .send({ name: 'x', expected_updated_at: '2026-01-01T00:00:00Z' });
    assert(res.status === 404, 'When the row is not found/not RLS-visible at all, the result is still 404 - the conditional-update feature never turns a real not-found into a 409');
    assert(call === 2, 'Both the conditional PATCH and the disambiguation GET were attempted');
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
