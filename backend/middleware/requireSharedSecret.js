// AUTH-003A-3 - a TEMPORARY, explicitly-named stopgap for the window
// before this app has a registered OAuth client and
// TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID can be set. requireAuth now
// refuses to run at all without a real expectedClientId (see its own
// header comment) - this exists so /api/openai can still be taken out
// of its current fully-open state in the meantime, WITHOUT pretending
// that's real OAuth/entitlement protection.
//
// This is NOT a substitute for requireAuth + requireEntitlement. It
// has no concept of a user id, no per-user entitlement check, no per-
// user quota - every holder of the one shared secret is equally
// trusted. It exists only to stop the endpoint being reachable by
// literally anyone on the internet while the real integration is being
// built, per the explicit "unless a temporary service restriction is
// separately approved" allowance. Remove this file and its one call
// site once requireAuth is live with a real expectedClientId.
//
// The secret is compared with a constant-time check (timingSafeEqual)
// since, unlike the OAuth `state` CSRF token elsewhere in this
// engagement's codebase, this IS a secret-derived comparison against
// attacker-controlled input.

import { timingSafeEqual } from 'node:crypto';

export function createRequireSharedSecret({ secret } = {}) {
  if (!secret) {
    throw new Error('requireSharedSecret: secret is required (set TEMPORARY_SHARED_SECRET).');
  }
  const secretBuf = Buffer.from(secret);

  return function requireSharedSecret(req, res, next) {
    const provided = req.headers['x-internal-access-token'];
    if (!provided) {
      return res.status(401).json({ error: { message: 'Missing access token.' } });
    }
    const providedBuf = Buffer.from(provided);
    if (providedBuf.length !== secretBuf.length || !timingSafeEqual(providedBuf, secretBuf)) {
      return res.status(401).json({ error: { message: 'Invalid access token.' } });
    }
    return next();
  };
}
