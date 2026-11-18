// AUTH-003B - single-use, TTL'd PKCE/state storage for the in-flight
// authorization request, between /auth/sso/start and /auth/sso/callback.
// Same pattern as invf/adveser-launch-studio's server/auth/oauth/ssoState.ts.
// In-memory - a process restart drops any in-flight (not yet completed)
// authorization attempt; the user just starts over, same documented
// trade-off as Launch Studio's.

const TTL_MS = 10 * 60 * 1000; // 10 minutes

let pending = new Map(); // state -> { codeVerifier, next, createdAt }

export function createPendingAuthorization(state, { codeVerifier, next, csrfToken }) {
  pending.set(state, { codeVerifier, next, csrfToken, createdAt: Date.now() });
}

// Single-use: consuming a state deletes it immediately, regardless of
// whether it was found or already expired - a replay of the exact same
// callback URL must never succeed twice.
export function consumePendingAuthorization(state) {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) return null;
  return entry;
}

export function __resetPendingAuthorizationsForTests() {
  pending = new Map();
}
