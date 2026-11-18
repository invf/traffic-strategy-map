// AUTH-003A-3 - requireSharedSecret.js, the TEMPORARY stopgap for the
// window before this app has a registered OAuth client.
// Run with: node backend/tests/requireSharedSecret.test.mjs

import { createRequireSharedSecret } from '../middleware/requireSharedSecret.js';

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
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function run() {
  // ===== Construction requires a secret =====
  {
    let threw = false;
    try {
      createRequireSharedSecret({});
    } catch {
      threw = true;
    }
    assert(threw, 'Constructing without a secret throws - there is no "unset means open" fallback here either');
  }

  const mw = createRequireSharedSecret({ secret: 'correct-secret-value' });

  // ===== No header at all =====
  {
    const req = { headers: {} };
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'Missing the header -> 401');
  }

  // ===== Wrong secret =====
  {
    const req = { headers: { 'x-internal-access-token': 'wrong-value' } };
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A wrong secret -> 401');
  }

  // ===== Wrong length (would break naive timingSafeEqual without the length check) =====
  {
    const req = { headers: { 'x-internal-access-token': 'short' } };
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 401 && !nextCalled, 'A shorter/longer value than the real secret -> 401, not a crash from timingSafeEqual on mismatched buffer lengths');
  }

  // ===== Correct secret =====
  {
    const req = { headers: { 'x-internal-access-token': 'correct-secret-value' } };
    const res = fakeRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    assert(nextCalled, 'The correct secret calls next()');
  }

  // ===== This middleware establishes NO user identity =====
  {
    const req = { headers: { 'x-internal-access-token': 'correct-secret-value' } };
    const res = fakeRes();
    mw(req, res, () => {});
    assert(req.userId === undefined, 'req.userId is never set by this middleware - Mode 2 has no per-user identity, confirmed, not assumed');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
