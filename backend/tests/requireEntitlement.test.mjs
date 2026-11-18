// AUTH-003A - requireEntitlement.js: entitlement gating + durable quota
// reservation (checkQuota is now required DI, no in-memory fallback).
// Run with: node backend/tests/requireEntitlement.test.mjs

import { createRequireEntitlement } from '../middleware/requireEntitlement.js';

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

function fakeQuotaAllowed(remaining = 10) {
  return async () => ({ allowed: true, remaining });
}
function fakeQuotaDenied() {
  return async () => ({ allowed: false, remaining: 0 });
}

async function run() {
  // ===== Construction requires both checkEntitlement and checkQuota =====
  {
    let threw = false;
    try { createRequireEntitlement({ checkEntitlement: async () => 'active' }); } catch { threw = true; }
    assert(threw, 'Constructing without checkQuota throws - there is no in-memory fallback anymore');
  }

  // ===== No req.userId at all =====
  {
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'active', checkQuota: fakeQuotaAllowed() });
    const req = {};
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 500 && !nextCalled, 'Running before requireAuth (no req.userId) is a 500, not silently allowed through');
  }

  // ===== Active entitlement + allowed quota -> next() =====
  {
    let checkedUserId;
    let quotaCheckedWith;
    const mw = createRequireEntitlement({
      checkEntitlement: async (id) => { checkedUserId = id; return 'active'; },
      checkQuota: async (id, limit) => { quotaCheckedWith = { id, limit }; return { allowed: true, remaining: 7 }; },
      dailyLimit: 20,
    });
    const req = { userId: 'user-a', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'An active entitlement + allowed quota calls next()');
    assert(checkedUserId === 'user-a', 'checkEntitlement is called with req.userId, never a caller-supplied id');
    assert(quotaCheckedWith.id === 'user-a' && quotaCheckedWith.limit === 20, 'checkQuota is called with the correct userId AND the configured dailyLimit');
    assert(res.headers['X-RateLimit-Remaining'] === '7', 'The remaining quota is reported back on the response');
  }

  // ===== No entitlement -> 403, quota never even checked =====
  {
    let quotaCalled = false;
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'none', checkQuota: async () => { quotaCalled = true; return { allowed: true, remaining: 1 }; } });
    const req = { userId: 'user-b', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 403 && !nextCalled, 'No entitlement -> 403');
    assert(!quotaCalled, 'Quota is never consulted for a non-entitled user - no point reserving quota for someone who cannot proceed anyway');
  }

  // ===== Entitlement check itself fails -> 503 =====
  {
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'error', checkQuota: fakeQuotaAllowed() });
    const req = { userId: 'user-c', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, 'An entitlement-check infrastructure failure is 503, never a denial');
  }

  // ===== Quota denied (at the limit) -> 429 =====
  {
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'active', checkQuota: fakeQuotaDenied() });
    const req = { userId: 'user-d', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 429 && !nextCalled, 'A denied quota (at the daily limit) is 429, never proceeds to call OpenAI');
  }

  // ===== Quota check itself fails (DB unreachable) -> FAILS CLOSED, 503, never treated as "no limit" =====
  {
    const mw = createRequireEntitlement({ checkEntitlement: async () => 'active', checkQuota: async () => { throw new Error('connection refused'); } });
    const req = { userId: 'user-e', path: '/api/openai' };
    const res = fakeRes();
    let nextCalled = false;
    await mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, 'Quota enforcement being unavailable fails CLOSED (503) - it is never silently treated as "no limit, let it through"');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
