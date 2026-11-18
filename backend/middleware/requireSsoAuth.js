// AUTH-003B - authenticates /api/openai via THIS app's own first-party
// SSO cookie, not a raw Bearer OAuth token. Because the session design
// (backend/auth/ssoSession.js) deliberately never hands an OAuth
// access/refresh token to the browser, the frontend has no Bearer
// token to attach at all - the cookie, sent automatically by the
// browser (credentials: 'include' + matching CORS config), is the only
// credential it has. backend/middleware/requireAuth.js (AUTH-003A,
// Bearer-token-based) remains correct for a DIFFERENT kind of caller
// that genuinely holds a raw access token directly - kept, not
// replaced, per this ticket's "keep the session mechanism replaceable"
// instruction. This file is what the real browser frontend actually uses.
import { readSessionCookie, verifySessionToken, isSessionActive, InvalidSessionTokenError } from '../auth/ssoSession.js';

export function requireSsoAuth(req, res, next) {
  const cookie = readSessionCookie(req.headers.cookie);
  if (!cookie) {
    return res.status(401).json({ error: { message: 'Missing or malformed Authorization header.' } });
  }
  try {
    const payload = verifySessionToken(cookie);
    if (!isSessionActive(payload.sid)) {
      // AUTH-001 Phase 4B (ported): a cryptographically valid, non-
      // expired cookie is not proof of an active session once logout
      // has deleted the underlying record.
      return res.status(401).json({ error: { message: 'Invalid or expired token.' } });
    }
    req.userId = payload.sub;
    // AUTH-003B: the strategies proxy (backend/routes/strategiesProxy.js)
    // needs the session id itself, not just the canonical user id, to
    // look up/refresh this user's cached real Supabase access token via
    // ensureValidAccessToken(sid, ...) in ssoRoutes.js.
    req.sid = payload.sid;
    return next();
  } catch (err) {
    if (err instanceof InvalidSessionTokenError) {
      // Deliberately a 401, not an automatic refresh attempt here -
      // refresh only ever happens via GET /auth/sso/session, same
      // discipline as Launch Studio's authMiddleware.ts.
      return res.status(401).json({ error: { message: 'Invalid or expired token.' } });
    }
    throw err;
  }
}
