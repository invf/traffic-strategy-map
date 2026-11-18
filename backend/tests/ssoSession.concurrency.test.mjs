// AUTH-003B pre-production audit - proves runSingleFlightRefresh under
// GENUINE concurrency (real overlapping async calls via Promise.all, not
// just sequential mocked calls), since the strategies proxy's
// ensureValidAccessToken() and GET /auth/sso/session can both trigger a
// refresh for the same sid at the same moment (e.g. two browser tabs,
// or a page load firing both the session check and a strategies
// request together) - this is exactly the scenario the ticket's
// "token refresh is safe under concurrent requests" item asks about.
//
// Run with: node backend/tests/ssoSession.concurrency.test.mjs

import { runSingleFlightRefresh, __resetInFlightRefreshesForTests } from '../auth/ssoSession.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  // ===== N genuinely concurrent callers for the SAME sid share ONE underlying operation =====
  {
    __resetInFlightRefreshesForTests();
    let callCount = 0;
    const operation = async () => {
      callCount += 1;
      await delay(30); // long enough that all 5 callers below are definitely "in flight" together
      return { ok: true, accessToken: 'fresh-token', callNumber: callCount };
    };

    const results = await Promise.all([
      runSingleFlightRefresh('sid-x', operation),
      runSingleFlightRefresh('sid-x', operation),
      runSingleFlightRefresh('sid-x', operation),
      runSingleFlightRefresh('sid-x', operation),
      runSingleFlightRefresh('sid-x', operation),
    ]);

    assert(callCount === 1, `Exactly one underlying refresh ran for 5 genuinely concurrent callers of the same sid (ran ${callCount}) - never one real OAuth refresh call per caller`);
    assert(results.every((r) => r.accessToken === 'fresh-token'), 'Every concurrent caller receives the SAME resolved result, not a stale or mismatched one');
  }

  // ===== Different sids never coalesce into each other's refresh =====
  {
    __resetInFlightRefreshesForTests();
    const callsPerSid = {};
    const operation = (sid) => async () => {
      callsPerSid[sid] = (callsPerSid[sid] || 0) + 1;
      await delay(20);
      return { ok: true, accessToken: `token-for-${sid}` };
    };

    const [a1, a2, b1] = await Promise.all([
      runSingleFlightRefresh('sid-a', operation('sid-a')),
      runSingleFlightRefresh('sid-a', operation('sid-a')),
      runSingleFlightRefresh('sid-b', operation('sid-b')),
    ]);

    assert(callsPerSid['sid-a'] === 1, 'Two concurrent callers for sid-a coalesce into one real refresh');
    assert(callsPerSid['sid-b'] === 1, 'The concurrent sid-b caller runs its own refresh, unaffected by sid-a\'s in-flight one');
    assert(a1.accessToken === 'token-for-sid-a' && a2.accessToken === 'token-for-sid-a', 'Both sid-a callers get sid-a\'s own token');
    assert(b1.accessToken === 'token-for-sid-b', 'sid-b never receives sid-a\'s token or vice versa - no cross-session leakage through the coalescing map');
  }

  // ===== After a refresh settles, the NEXT call for the same sid runs its own fresh operation (not stuck reusing the old promise) =====
  {
    __resetInFlightRefreshesForTests();
    let callCount = 0;
    const operation = async () => {
      callCount += 1;
      return { ok: true, accessToken: `token-${callCount}` };
    };

    const first = await runSingleFlightRefresh('sid-y', operation);
    const second = await runSingleFlightRefresh('sid-y', operation);

    assert(callCount === 2, 'A second, SEQUENTIAL call (after the first has fully settled) runs its own real operation, rather than permanently reusing the first result');
    assert(first.accessToken === 'token-1' && second.accessToken === 'token-2', 'Each sequential call gets its own fresh result');
  }

  // ===== A failed refresh does not poison later calls for the same sid =====
  {
    __resetInFlightRefreshesForTests();
    let attempt = 0;
    const operation = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('simulated refresh failure');
      return { ok: true, accessToken: 'recovered-token' };
    };

    await assertRejects(() => runSingleFlightRefresh('sid-z', operation));
    const recovered = await runSingleFlightRefresh('sid-z', operation);
    assert(recovered.accessToken === 'recovered-token', 'A later call for the same sid, after a prior failure, succeeds normally - the in-flight map entry is cleaned up even on rejection');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

async function assertRejects(fn) {
  try {
    await fn();
    assert(false, 'Expected the operation to reject, but it resolved');
  } catch {
    assert(true, 'The operation rejected as expected');
  }
}

run();
