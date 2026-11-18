// AUTH-003A - verifies a Bearer access token issued by the shared
// ADVESER Supabase project (eukogyljakqafnuvrfiv) against that
// project's own JWKS, exactly the same verification Launch Studio's
// server/auth/oauth/verifyAccessToken.ts already does successfully in
// production - reused here rather than reinvented.
//
// This does NOT special-case OAuth-Server-issued tokens vs a regular
// browser-session token - per Supabase's own docs (oauth-server/token-
// security), an OAuth access token carries the same standard claims
// (sub, role, aud, iss) plus an additional client_id; verifying
// signature + issuer + audience is identical either way. What this
// middleware does NOT itself prove is end-to-end RLS compatibility -
// see docs/AUTH_003A_OAUTH_RLS_TEST.md for that separate question.
//
// Fails closed: any verification failure is a 401, never a silent
// pass-through. Never logs the token itself.

import { createRemoteJWKSet, jwtVerify } from 'jose';

export function createRequireAuth({ supabaseUrl, jwksUri, issuer, audience = 'authenticated' } = {}) {
  // SUPABASE_URL, not VITE_SUPABASE_URL - this runs in the Express
  // backend, not the Vite-built frontend; Vite's VITE_-prefix convention
  // doesn't apply here and there is no build-time inlining to rely on.
  // Only required as a fallback when the caller hasn't already supplied
  // both jwksUri and issuer directly (as tests do, pointing at a local
  // JWKS server rather than the real project).
  const url = supabaseUrl || process.env.SUPABASE_URL;
  if (!url && (!jwksUri || !issuer)) {
    throw new Error('requireAuth: supabaseUrl (or SUPABASE_URL) is required unless both jwksUri and issuer are given explicitly.');
  }
  const resolvedIssuer = issuer || `${url}/auth/v1`;
  const resolvedJwksUri = jwksUri || `${url}/auth/v1/.well-known/jwks.json`;
  const jwks = createRemoteJWKSet(new URL(resolvedJwksUri));

  return async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Missing or malformed Authorization header.' } });
    }
    const token = header.slice('Bearer '.length);

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer: resolvedIssuer, audience });
      if (!payload.sub) {
        return res.status(401).json({ error: { message: 'Token has no subject claim.' } });
      }
      req.userId = payload.sub;
      req.tokenClaims = payload;
      return next();
    } catch (err) {
      // Deliberately generic - never echoes the token or the raw jose
      // error (which can include fragments of the JWT) back to the client.
      console.error('[requireAuth] Token verification failed:', err?.code ?? err?.name ?? 'unknown');
      return res.status(401).json({ error: { message: 'Invalid or expired token.' } });
    }
  };
}
