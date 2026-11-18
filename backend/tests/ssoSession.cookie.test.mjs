// AUTH-003B pre-production audit - the session cookie's SameSite mode
// must default to None (today's split Vercel/Render origin reality)
// but become a pure env var flip once a same-origin reverse proxy is
// adopted (see docs/AUTH_003B_PRE_PRODUCTION_AUDIT.md) - no code
// change should be required for that cutover.
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
    assert(header.includes('SameSite=None'), 'Default (no env var set): SameSite=None - correct for the current split-origin deployment');
    assert(header.includes('Secure'), 'Secure is always present alongside SameSite=None');
  }

  process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE = 'Lax';
  {
    const header = buildSessionCookieHeader('a-token');
    assert(header.includes('SameSite=Lax'), 'TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=Lax switches the cookie mode - the one env var flip a same-origin-proxy cutover needs, no code change');
    assert(header.includes('Secure'), 'Secure remains present under Lax too - never dropped');
    const clearHeader = buildClearSessionCookieHeader();
    assert(clearHeader.includes('SameSite=Lax'), 'The clearing (logout) cookie header uses the same configured mode, so it actually matches and clears the real cookie');
  }

  process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE = 'Strict';
  assert(buildSessionCookieHeader('a-token').includes('SameSite=Strict'), 'Strict is also accepted');

  process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE = 'not-a-real-value';
  assert(buildSessionCookieHeader('a-token').includes('SameSite=None'), 'An invalid configured value fails closed to None (the current correct default), never produces a malformed/unset SameSite attribute');

  delete process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE;

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
