// AUTH-003B - pkce.js primitives.
// Run with: node backend/tests/pkce.test.mjs

import { generateCodeVerifier, generateCodeChallenge, generateState, isValidState } from '../auth/pkce.js';
import { createHash } from 'node:crypto';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function run() {
  const v1 = generateCodeVerifier();
  const v2 = generateCodeVerifier();
  assert(v1 !== v2, 'Two generated code verifiers are different (real randomness, not a fixture)');
  assert(!v1.includes('+') && !v1.includes('/') && !v1.includes('='), 'The verifier is base64url, not plain base64 (no +, /, or = padding)');

  const challenge = generateCodeChallenge(v1);
  const expected = base64url(createHash('sha256').update(v1).digest());
  assert(challenge === expected, 'The challenge is exactly SHA-256(verifier), base64url-encoded - the standard PKCE S256 transform');

  const s1 = generateState();
  const s2 = generateState();
  assert(s1 !== s2, 'Two generated state values are different');

  assert(isValidState(s1, s1) === true, 'A state matched against itself is valid');
  assert(isValidState(s1, s2) === false, 'Two different states do not match');
  assert(isValidState('', s1) === false, 'An empty received value never matches, even defensively');
  assert(isValidState(s1, '') === false, 'An empty expected value never matches');
  assert(isValidState(null, s1) === false, 'null received value is handled without throwing');

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
