// AUTH-003B pre-production audit, Task 6 ("Strategies CRUD and RLS
// isolation") - EXECUTED proof that backend/routes/strategiesProxy.js
// composed with the REAL public.strategies RLS policies actually
// isolates two real users, not just that each half (the proxy's own
// logic, and RLS itself) is separately correct. Two real GoTrue users,
// real access tokens, the REAL createStrategiesRouter (not a fake),
// against a disposable local Supabase stack.
//
// Run with (after `npx supabase db reset` - see this session's own
// migration-deferral steps, since adveser_core-dependent migrations
// don't exist on a fresh local stack):
//   node backend/rehearsal_strategies_proxy.mjs

import express from 'express';
import request from 'supertest';
import { createStrategiesRouter } from './routes/strategiesProxy.js';

const API_URL = 'http://127.0.0.1:54321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

async function rest(path, { method = 'GET', key = ANON_KEY, token, body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function createUser(email, password) {
  const { status, body } = await rest('/auth/v1/admin/users', { method: 'POST', key: SERVICE_ROLE_KEY, body: { email, password, email_confirm: true } });
  if (status !== 200) throw new Error(`createUser failed: ${status} ${JSON.stringify(body)}`);
  return body.id;
}
async function signIn(email, password) {
  const { status, body } = await rest('/auth/v1/token?grant_type=password', { method: 'POST', key: ANON_KEY, body: { email, password } });
  if (status !== 200) throw new Error(`signIn failed: ${status} ${JSON.stringify(body)}`);
  return body.access_token;
}

// Builds a tiny app mounting the REAL strategiesProxy router behind a
// fake session middleware - ensureValidAccessToken is a thin fake that
// just returns whichever real GoTrue token this "session" already
// holds (the OAuth refresh machinery itself is proven separately in
// backend/tests/ssoSession.concurrency.test.mjs; this rehearsal is
// about what happens AFTER a valid token is in hand).
function appForUser(userId, realAccessToken) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.userId = userId; req.sid = `sid-${userId}`; next(); });
  app.use(createStrategiesRouter({
    ensureValidAccessToken: async () => realAccessToken,
    supabaseUrl: API_URL,
    supabaseAnonKey: ANON_KEY,
  }));
  return app;
}

async function run() {
  const userAId = await createUser('proxy-rehearsal-a@test.local', 'password-a-1');
  const userBId = await createUser('proxy-rehearsal-b@test.local', 'password-b-1');
  const tokenA = await signIn('proxy-rehearsal-a@test.local', 'password-a-1');
  const tokenB = await signIn('proxy-rehearsal-b@test.local', 'password-b-1');
  const appA = appForUser(userAId, tokenA);
  const appB = appForUser(userBId, tokenB);

  // ===== User A creates a private strategy through the REAL proxy =====
  const createRes = await request(appA).post('/api/strategies').send({ name: "A's strategy", nodes: [1], edges: [], product_info: { name: 'P' }, ai_suggestions: {} });
  assert(createRes.status === 201, 'POST /api/strategies through the real proxy -> 201');
  const strategyId = createRes.body.id;
  assert(createRes.body.user_id === userAId, "The created row's user_id is really A's own id, as enforced by RLS WITH CHECK, confirmed via a REAL PostgREST response, not a mock");

  // ===== User A can list and read it back =====
  {
    const listRes = await request(appA).get('/api/strategies');
    assert(listRes.status === 200 && listRes.body.some((s) => s.id === strategyId), "User A's own list includes the strategy they just created");
    const getRes = await request(appA).get(`/api/strategies/${strategyId}`);
    assert(getRes.status === 200 && getRes.body.id === strategyId, 'User A can fetch the full row by id');
  }

  // ===== User B cannot see it at all - through the REAL proxy, REAL RLS =====
  {
    const listRes = await request(appB).get('/api/strategies');
    assert(listRes.status === 200 && !listRes.body.some((s) => s.id === strategyId), "User B's own list does NOT include User A's strategy - real cross-user isolation through the actual proxy, not a mocked assumption");
    const getRes = await request(appB).get(`/api/strategies/${strategyId}`);
    assert(getRes.status === 404, "User B fetching User A's strategy by id gets 404 (RLS makes it invisible, not a distinguishable 403) - proxy correctly relays PostgREST's real 'not found' shape");
  }

  // ===== User B cannot edit or delete User A's strategy =====
  {
    const patchRes = await request(appB).patch(`/api/strategies/${strategyId}`).send({ name: 'hijacked' });
    assert(patchRes.status === 404, "User B PATCHing User A's strategy -> 404, never a silent no-op success and never actually applied");
    const deleteRes = await request(appB).delete(`/api/strategies/${strategyId}`);
    assert(deleteRes.status === 404, "User B DELETEing User A's strategy -> 404, the row is untouched");
  }
  {
    const getRes = await request(appA).get(`/api/strategies/${strategyId}`);
    assert(getRes.status === 200 && getRes.body.name === "A's strategy", "User A's strategy is completely unaffected by User B's attempts - still exists, name unchanged");
  }

  // ===== AUTH-004: concurrent edits / stale-write prevention, against the REAL stack =====
  // Simulates two browsers both signed in as User A: one ("browser 1")
  // fetches the row and holds its updated_at; "browser 2" saves a
  // change first; browser 1's save, still carrying the now-stale
  // updated_at, must be rejected (409) rather than silently clobbering
  // browser 2's change - then a fresh save (using the updated_at the
  // 409 handed back) succeeds. Also proves RLS invisibility still wins
  // over the new conflict check: User B's conditional PATCH on A's row
  // gets 404, never 409 - a real cross-user proof, not an assumption.
  {
    const browser1Get = await request(appA).get(`/api/strategies/${strategyId}`);
    assert(browser1Get.status === 200, "Browser 1 (User A) fetches the row and holds its updated_at");
    const staleUpdatedAt = browser1Get.body.updated_at;

    const browser2Patch = await request(appA)
      .patch(`/api/strategies/${strategyId}`)
      .send({ name: "changed by browser 2" });
    assert(browser2Patch.status === 200, 'Browser 2 (same user, different session) saves first, unconditionally');
    assert(browser2Patch.body.updated_at !== staleUpdatedAt, "The real row's updated_at actually advanced after browser 2's save (a real Postgres timestamp, not a mocked one)");

    const browser1StalePatch = await request(appA)
      .patch(`/api/strategies/${strategyId}`)
      .send({ name: "browser 1's stale edit", expected_updated_at: staleUpdatedAt });
    assert(browser1StalePatch.status === 409, "Browser 1's save, still carrying the now-stale updated_at, is rejected with 409 against the REAL conditional UPDATE - never silently overwrites browser 2's change");
    assert(browser1StalePatch.body.current?.name === 'changed by browser 2', "The 409 body carries the row's real current state (browser 2's change), not browser 1's stale view");

    const browser1FreshPatch = await request(appA)
      .patch(`/api/strategies/${strategyId}`)
      .send({ name: "browser 1's reconciled edit", expected_updated_at: browser1StalePatch.body.current.updated_at });
    assert(browser1FreshPatch.status === 200 && browser1FreshPatch.body.name === "browser 1's reconciled edit", "Using the updated_at the 409 just handed back, browser 1's retry succeeds against the real stack");

    const crossUserConditionalPatch = await request(appB)
      .patch(`/api/strategies/${strategyId}`)
      .send({ name: 'hijacked', expected_updated_at: browser1FreshPatch.body.updated_at });
    assert(crossUserConditionalPatch.status === 404, "User B's conditional PATCH on A's row is STILL 404, not 409 - RLS invisibility takes priority over the new conflict check, confirmed against the real stack rather than assumed");
  }

  // ===== User B creates their own - independent of User A's =====
  const createBRes = await request(appB).post('/api/strategies').send({ name: "B's strategy", nodes: [], edges: [], product_info: {}, ai_suggestions: {} });
  assert(createBRes.status === 201 && createBRes.body.user_id === userBId, "User B can create their own strategy, correctly attributed to B's own real id");
  {
    const listA = await request(appA).get('/api/strategies');
    assert(!listA.body.some((s) => s.id === createBRes.body.id), "User A's list does not include User B's strategy either - isolation holds in both directions");
  }

  // ===== User A can edit and delete their own, through the real proxy =====
  {
    const patchRes = await request(appA).patch(`/api/strategies/${strategyId}`).send({ name: 'renamed by owner' });
    assert(patchRes.status === 200 && patchRes.body.name === 'renamed by owner', "User A CAN edit their own strategy through the real proxy");
    const deleteRes = await request(appA).delete(`/api/strategies/${strategyId}`);
    assert(deleteRes.status === 204, "User A CAN delete their own strategy through the real proxy");
    const getRes = await request(appA).get(`/api/strategies/${strategyId}`);
    assert(getRes.status === 404, 'The deleted strategy is really gone');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
