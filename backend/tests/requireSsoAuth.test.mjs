// AUTH-003B - requireSsoAuth.js: the SSO-cookie-based auth gate for
// /api/openai (the real browser frontend's own credential - tokens
// never leave this server, so there is no Bearer header to check here).
// Run with: node backend/tests/requireSsoAuth.test.mjs

import { requireSsoAuth } from '../middleware/requireSsoAuth.js';
import { createSsoSession, mintSessionToken, signSessionToken, __resetSsoSessionStoreForTests, SSO_COOKIE_NAME } from '../auth/ssoSession.js';

process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET = process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET || 'test-only-session-secret-do-not-use-in-production';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run() {
  // ===== No cookie at all =====
  {
    const req = { headers: {} };
    const res = fakeRes();
    let nextCalled = false;
    requireSsoAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'No cookie -> 401');
  }

  // ===== Valid cookie =====
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-a', email: 'a@example.com', refreshToken: 'rt-a' });
    const token = mintSessionToken(sid, 'user-a', 'a@example.com');
    const req = { headers: { cookie: `${SSO_COOKIE_NAME}=${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    requireSsoAuth(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'A valid, active-session cookie calls next()');
    assert(req.userId === 'user-a', 'req.userId is set to the canonical user id (the sub claim), not the sid');
  }

  // ===== Expired cookie - this middleware never refreshes, just 401s =====
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-b', email: 'b@example.com', refreshToken: 'rt-b' });
    const expired = signSessionToken({ sid, sub: 'user-b', email: 'b@example.com', exp: Math.floor(Date.now() / 1000) - 10 });
    const req = { headers: { cookie: `${SSO_COOKIE_NAME}=${expired}` } };
    const res = fakeRes();
    let nextCalled = false;
    requireSsoAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'An expired cookie is a 401 here - refresh only happens via GET /auth/sso/session, never silently inline in this hot path');
  }

  // ===== Forged/garbage cookie =====
  {
    const req = { headers: { cookie: `${SSO_COOKIE_NAME}=garbage.notasignature` } };
    const res = fakeRes();
    let nextCalled = false;
    requireSsoAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A forged/garbage cookie -> 401');
  }

  // ===== AUTH-001 Phase 4B (ported): valid signature+exp, but the session was logged out =====
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-c', email: 'c@example.com', refreshToken: 'rt-c' });
    const token = mintSessionToken(sid, 'user-c', 'c@example.com');
    // Simulate logout: delete the record directly (same effect as the real /auth/sso/logout route).
    const { deleteSsoSession } = await import('../auth/ssoSession.js');
    deleteSsoSession(sid);
    const req = { headers: { cookie: `${SSO_COOKIE_NAME}=${token}` } };
    const res = fakeRes();
    let nextCalled = false;
    requireSsoAuth(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A valid, unexpired cookie whose session was deleted (logged out) is rejected - signature+exp alone is never enough, ported from AUTH-001 Phase 4B from the start rather than discovered as a bug later');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
