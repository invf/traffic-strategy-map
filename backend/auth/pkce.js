// AUTH-003B - PKCE helpers, same primitives already proven in
// invf/adveser-launch-studio's server/auth/oauth/pkce.ts, ported to
// plain JS for this Express backend.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier() {
  return base64url(randomBytes(32));
}

export function generateCodeChallenge(verifier) {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function generateState() {
  return base64url(randomBytes(16));
}

// Constant-time comparison for the OAuth `state` CSRF token. Unlike a
// secret-derived value (a session token's signature), this is compared
// against a value THIS server already generated and stored - still
// worth comparing safely since it's compared against attacker-
// controlled input (the query string), same reasoning Launch Studio's
// own pkce.ts documents.
export function isValidState(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
