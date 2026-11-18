// AUTH-003B same-origin proxy (Option B, approved) - the session
// cookie's SameSite mode now defaults to Lax, correct now that
// frontend and backend are same-site via the Vercel reverse proxy
// (see docs/AUTH_003B_PRE_PRODUCTION_AUDIT.md). TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=None
// remains available as an explicit, temporary rollback switch - a
// pure env var flip, no code change, for exactly that scenario.
// Run with: node backend/tests/ssoSession.cookie.test.mjs

process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET = process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET || 'test-only-session-secret-do-not-use-in-production';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

async function run() {
  delete process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE;
  const { buildSessionCookieHeader, buildClearSessionCookieHeader } = await import('../auth/ssoSession.js');

  {
    const header = buildSessionCookieHeader('a-token');
    assert(header.includes('SameSite=Lax'), 'Default (no env var set): SameSite=Lax - correct now that frontend/backend are same-site via the Vercel proxy');
    assert(header.includes('Secure'), 'Secure is always present alongside SameSite=Lax');
  }

  process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE = 'None';
  {
    const header = buildSessionCookieHeader('a-token');
    assert(header.includes('SameSite=None'), 'TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=None is an explicit rollback switch to the old split-origin shape - a pure env var flip, no code change');
    assert(header.includes('Secure'), 'Secure remains present under None too - never dropped');
    const clearHeader = buildClearSessionCookieHeader();
    assert(clearHeader.includes('SameSite=None'), 'The clearing (logout) cookie header uses the same configured mode, so it actually matches and clears the real cookie');
  }

  process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE = 'Strict';
  assert(buildSessionCookieHeader('a-token').includes('SameSite=Strict'), 'Strict is also accepted');

  process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE = 'not-a-real-value';
  assert(buildSessionCookieHeader('a-token').includes('SameSite=Lax'), 'An invalid configured value fails closed to Lax (the current correct default), never to the weaker None, and never produces a malformed/unset SameSite attribute');

  delete process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE;

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
