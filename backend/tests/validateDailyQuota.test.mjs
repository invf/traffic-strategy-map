// AUTH-003A - strict validation of OPENAI_DAILY_QUOTA at startup.
// Run with: node backend/tests/validateDailyQuota.test.mjs

import { validateDailyQuota } from '../lib/validateDailyQuota.js';

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
function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    console.error(`[FAIL] ${message} (did not throw)`);
  } catch {
    passed++;
    console.log(`[PASS] ${message}`);
  }
}

function run() {
  // ===== Not set at all - caller uses its own default =====
  assert(validateDailyQuota(undefined) === undefined, 'undefined (unset) returns undefined, not an error - the caller applies its own default');
  assert(validateDailyQuota('') === undefined, 'An empty string (how some platforms represent "unset") also returns undefined');

  // ===== Valid values =====
  assert(validateDailyQuota('1') === 1, 'The minimum valid value, 1, is accepted');
  assert(validateDailyQuota('50') === 50, 'A normal value is accepted and returned as a real number, not a string');
  assert(validateDailyQuota('10000') === 10000, 'Exactly the maximum (10000) is accepted');
  assert(validateDailyQuota(50) === 50, 'A real number (not just a string) is also accepted - env vars are usually strings, but this should not assume that');

  // ===== Invalid: non-numeric =====
  assertThrows(() => validateDailyQuota('abc'), "A non-numeric string ('abc') throws, never silently becomes NaN");
  assertThrows(() => validateDailyQuota('50abc'), "A partially-numeric string ('50abc') throws - Number()'s own permissiveness is not trusted");
  assertThrows(() => validateDailyQuota('1e3'), "Scientific notation ('1e3') is rejected - only a plain base-10 integer string is accepted, even though Number('1e3') === 1000");

  // ===== Invalid: out of range =====
  assertThrows(() => validateDailyQuota('0'), 'Zero throws - a daily quota of 0 should be expressed by disabling the feature, not by this value');
  assertThrows(() => validateDailyQuota('-5'), 'A negative value throws, never silently treated as "no limit" or passed through to break the SQL');
  assertThrows(() => validateDailyQuota('10001'), 'One over the maximum throws - bounded at the top, not just the bottom, since this is a spending control and an unbounded value is more likely a typo than a deliberate choice');
  assertThrows(() => validateDailyQuota('999999999999999999999'), 'An absurdly large value throws rather than overflow into something unpredictable');

  // ===== Invalid: non-integer =====
  assertThrows(() => validateDailyQuota('3.5'), 'A non-integer value throws - a fractional "number of requests" makes no sense');

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
