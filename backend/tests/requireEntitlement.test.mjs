// AUTH-003A - requireEntitlement.js: entitlement gating, rate limiting,
// and the error/denial/infrastructure-failure distinction.
// Run with: node backend/tests/requireEntitlement.test.mjs

import { createRequireEntitlement, __resetRateLimiterForTests } from '../middleware/requireEntitlement.js';

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

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

async function run() {
  // ===== No req.userId at all (requireAuth did not run first) =====
  {
    __resetRateLimiterForTests();
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'active' });
    const req = {};
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 500 && !nextCalled, 'Running before requireAuth (no req.userId) is a 500, not silently allowed through');
  }

  // ===== Active entitlement -> allowed =====
  {
    __resetRateLimiterForTests();
    let checkedUserId;
    const mw = createRequireEntitlement({ checkEntitlement: async (id) => { checkedUserId = id; return 'active'; } });
    const req = { userId: 'user-a', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'An active entitlement calls next()');
    assert(checkedUserId === 'user-a', 'checkEntitlement is called with req.userId, never a caller-supplied id');
  }

  // ===== No entitlement -> 403, never confused with an infrastructure error =====
  {
    __resetRateLimiterForTests();
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'none' });
    const req = { userId: 'user-b', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 403 && !nextCalled, 'No entitlement -> 403, request never proceeds to call OpenAI');
  }

  // ===== Entitlement check itself fails (DB unreachable) -> 503, never treated as a denial =====
  {
    __resetRateLimiterForTests();
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'error' });
    const req = { userId: 'user-c', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, "An entitlement-check infrastructure failure is 503 (try again), never 403 (denied) - the two must never be conflated");
  }
  {
    __resetRateLimiterForTests();
    const mw = createRequireEntitlement({ checkEntitlement: async () => { throw new Error('connection refused'); } });
    const req = { userId: 'user-d', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, 'A thrown error from checkEntitlement is also 503, not an unhandled crash');
  }

  // ===== Per-user daily rate limit =====
  {
    __resetRateLimiterForTests();
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'active', dailyLimit: 3 });
    const req = { userId: 'user-e', path: '/api/openai' };
    let allowedCount = 0;
    for (let i = 0; i < 5; i++) {
      const res = fakeRes();
      let nextCalled = false;
      await mw(req, res, () => { nextCalled = true; allowedCount++; });
      if (i < 3) assert(nextCalled, `Request ${i + 1} of 3 within the daily limit is allowed`);
      else assert(res.statusCode === 429 && !nextCalled, `Request ${i + 1}, beyond the daily limit of 3, is rejected with 429`);
    }
    assert(allowedCount === 3, 'Exactly 3 requests were allowed through for this user, never more');
  }

  // ===== Rate limit is PER USER, not global =====
  {
    __resetRateLimiterForTests();
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'active', dailyLimit: 1 });
    const reqA = { userId: 'user-f', path: '/api/openai' };
    const reqB = { userId: 'user-g', path: '/api/openai' };
    let aAllowed = false;
    let bAllowed = false;
    await mw(reqA, fakeRes(), () => { aAllowed = true; });
    await mw(reqA, fakeRes(), () => {}); // user-f's 2nd request, should be rejected
    await mw(reqB, fakeRes(), () => { bAllowed = true; });
    assert(aAllowed, 'User F gets their one allowed request');
    assert(bAllowed, "User G's own limit is untouched by user F having exhausted theirs - rate limiting is per-user, not shared");
  }

  // ===== recordUsage is called, but its failure never blocks the response =====
  {
    __resetRateLimiterForTests();
    let usageCalledWith;
    const mw = createRequireEntitlement({
      checkEntitlement: async () => 'active',
      recordUsage: async (userId, meta) => { usageCalledWith = { userId, meta }; throw new Error('usage table unreachable'); },
    });
    const req = { userId: 'user-h', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'A failing recordUsage() (fire-and-forget) never blocks the actual request from proceeding');
    await new Promise((r) => setTimeout(r, 10)); // let the fire-and-forget rejection settle
    assert(usageCalledWith?.userId === 'user-h', 'recordUsage is called with the correct userId regardless of its own outcome');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
