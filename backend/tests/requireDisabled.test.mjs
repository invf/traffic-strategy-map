// AUTH-003A - requireDisabled.js: the endpoint is OFF, not gated by a
// secret that would leak into the frontend bundle. See
// docs/AUTH_003A_SHARED_SECRET_REVIEW.md for why.
// Run with: node backend/tests/requireDisabled.test.mjs

import { requireDisabled } from '../middleware/requireDisabled.js';

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

function run() {
  // ===== Every request, regardless of headers/body, gets 503 =====
  {
    const req = { headers: {}, body: {} };
    const res = fakeRes();
    let nextCalled = false;
    requireDisabled(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, 'A plain request with no credentials of any kind gets 503, never calls next()');
  }
  {
    // Even a request that tries to present SOME credential (as if
    // guessing at a secret scheme) is treated identically - there is
    // no header this middleware ever inspects at all.
    const req = { headers: { authorization: 'Bearer anything', 'x-internal-access-token': 'anything' }, body: {} };
    const res = fakeRes();
    let nextCalled = false;
    requireDisabled(req, res, () => { nextCalled = true; });
    assert(res.statusCode === 503 && !nextCalled, 'A request presenting ANY credential-shaped header is treated identically to one with none - there is no secret this middleware checks, by design');
  }
  {
    const req = { headers: {}, body: {} };
    const res = fakeRes();
    requireDisabled(req, res, () => {});
    assert(typeof res.body?.error?.message === 'string' && res.body.error.message.length > 0, 'A clear, human-readable message is returned, not a bare empty error');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
