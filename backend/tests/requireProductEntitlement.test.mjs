// AUTH-003B pre-deployment audit fix - requireProductEntitlement.js:
// the entitlement-only gate for /api/strategies, fixing the confirmed
// gap where requireSsoAuth (authentication) alone let any signed-in
// ADVESER account use the strategies feature regardless of whether
// they actually hold the traffic_strategy_map entitlement.
// Run with: node backend/tests/requireProductEntitlement.test.mjs

import { createRequireProductEntitlement } from '../middleware/requireProductEntitlement.js';

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
  // ===== Construction requires checkEntitlement =====
  {
    let threw = false;
    try { createRequireProductEntitlement({}); } catch { threw = true; }
    assert(threw, 'Constructing without checkEntitlement throws');
  }

  // ===== No req.userId at all (requireSsoAuth must run first) =====
  {
    const mw = createRequireProductEntitlement({ checkEntitlement: async () => 'active' });
    const req = {};
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 500 && !nextCalled, 'Running before requireSsoAuth (no req.userId) is a 500, not silently allowed through');
  }

  // ===== Requirement 1: authenticated AND entitled -> next() =====
  {
    let checkedUserId;
    const mw = createRequireProductEntitlement({ checkEntitlement: async (id) => { checkedUserId = id; return 'active'; } });
    const req = { userId: 'entitled-user' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'An active entitlement calls next() - the strategies router is reached');
    assert(checkedUserId === 'entitled-user', 'checkEntitlement is called with req.userId, never a caller-supplied id');
  }

  // ===== Requirement 2: authenticated, no entitlement at all -> 403 =====
  {
    const mw = createRequireProductEntitlement({ checkEntitlement: async () => 'none' });
    const req = { userId: 'no-entitlement-user' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 403 && !nextCalled, 'No traffic_strategy_map entitlement -> 403, strategiesRouter never reached');
  }

  // ===== Requirement 3: entitled only to a DIFFERENT product -> 403 =====
  // checkEntitlement's own real implementation (lib/entitlements.js)
  // queries WHERE product = 'traffic_strategy_map' specifically - an
  // account entitled only to launch_studio has no matching row there
  // at all, so it returns 'none' exactly like having no entitlement.
  // This fake makes that same real-world shape explicit.
  {
    const entitlements = { 'launch-studio-only-user': 'launch_studio' };
    const mw = createRequireProductEntitlement({
      checkEntitlement: async (id) => (entitlements[id] === 'traffic_strategy_map' ? 'active' : 'none'),
    });
    const req = { userId: 'launch-studio-only-user' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 403 && !nextCalled, 'An account entitled only to a DIFFERENT product (Launch Studio) -> 403, never treated as entitled here');
  }

  // ===== Requirement 5: entitlement check itself fails (infrastructure) -> 503, never granted =====
  {
    const mw = createRequireProductEntitlement({ checkEntitlement: async () => 'error' });
    const req = { userId: 'some-user' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, 'An entitlement-check infrastructure failure is 503, NEVER treated as permission granted');
  }
  {
    // A thrown error (rather than the real implementation's own
    // internal 'error' return) must be handled identically - fail
    // closed either way, never let an exception become an accidental
    // next() call.
    const mw = createRequireProductEntitlement({ checkEntitlement: async () => { throw new Error('connection refused'); } });
    const req = { userId: 'some-user' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, 'A thrown error from checkEntitlement is also 503, never treated as permission granted');
  }

  // ===== Never consumes any quota - this middleware has no checkQuota concept at all =====
  {
    const mw = createRequireProductEntitlement({ checkEntitlement: async () => 'active' });
    assert(mw.length === 3, 'The middleware signature is the plain (req, res, next) shape, with no quota dependency threaded through it anywhere');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
