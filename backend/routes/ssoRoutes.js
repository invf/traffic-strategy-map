// AUTH-003B - the SSO router: /auth/sso/{start,callback,session,logout}.
// Mounted OUTSIDE auth-gated routes (these are the flow's own entry/
// exit points). Same structure as invf/adveser-launch-studio's proven
// ssoRoutes.ts, dependency-injected for testability (createSsoRouter's
// own convention, matching this engagement's established pattern).
//
// ONE REAL DIFFERENCE from Launch Studio: redirect_uri points at THIS
// backend (Render), not the frontend (Vercel) - necessary to keep the
// OAuth client secret server-side only. /auth/sso/callback therefore
// redirects the BROWSER to the frontend only at the very end, after
// the first-party session cookie is already set - never before.
//
// Every error path redirects to the frontend with an `sso_error` query
// flag, never a raw 500 or a dead end.

import { Router } from 'express';
import { generateCodeVerifier, generateCodeChallenge, generateState, isValidState } from '../auth/pkce.js';
import { buildAuthorizationUrl, exchangeCodeForTokens as realExchangeCodeForTokens, refreshTokens as realRefreshTokens, verifyAccessTokenForClient as realVerifyAccessTokenForClient, getOAuthClientConfig as realGetOAuthClientConfig, OAuthProtocolError } from '../auth/oauthClient.js';
import { createPendingAuthorization, consumePendingAuthorization } from '../auth/ssoState.js';
import {
  createSsoSession,
  getSsoSession,
  updateSsoSessionRefreshToken,
  cacheAccessToken,
  getCachedAccessToken,
  deleteSsoSession,
  mintSessionToken,
  verifySessionToken,
  readSessionCookie,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
  readOauthCsrfCookie,
  buildOauthCsrfCookieHeader,
  buildClearOauthCsrfCookieHeader,
  runSingleFlightRefresh,
  isSessionActive,
  InvalidSessionTokenError,
} from '../auth/ssoSession.js';

function redirectWithError(res, frontendUrl, code) {
  // Always clear the OAuth login-CSRF cookie on any error exit from
  // this flow, whether or not it was ever set (harmless either way) -
  // never leave a stale one sitting around for a retried attempt.
  res.setHeader('Set-Cookie', buildClearOauthCsrfCookieHeader());
  res.redirect(`${frontendUrl}/?sso_error=${code}`);
}

function sanitizeReturnTo(value) {
  // Internal, relative, same-origin (on the FRONTEND) paths only - the
  // same allowlist-of-shape discipline used throughout this engagement
  // (adveser-platform's lib/auth/safeRedirect.ts). This app has no
  // product-specific sub-paths to allowlist beyond "a plain path."
  if (!value || typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\')) return '/';
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return '/';
  return value;
}

async function performSessionRefresh(sid, record, config, deps) {
  try {
    const tokens = await deps.refreshTokens(config, { refreshToken: record.refreshToken });
    const claims = await deps.verifyAccessTokenForClient(tokens.access_token, config);
    if (!isSessionActive(sid)) {
      // AUTH-001 Phase 4B (ported): logout may have deleted this sid
      // while the refresh was in flight - never resurrect it.
      return { ok: false };
    }
    updateSsoSessionRefreshToken(sid, tokens.refresh_token ?? record.refreshToken);
    cacheAccessToken(sid, tokens.access_token, tokens.expires_in ?? 3600);
    return { ok: true, token: mintSessionToken(sid, claims.sub, record.email), email: record.email, accessToken: tokens.access_token };
  } catch (err) {
    console.error('[sso/session] Refresh failed:', err instanceof OAuthProtocolError ? err.message : (err?.message ?? err));
    deleteSsoSession(sid);
    return { ok: false };
  }
}

// AUTH-003B - used by backend/routes/strategiesProxy.js, which needs
// the user's REAL Supabase access token to relay PostgREST calls on
// their behalf (public.strategies is RLS-protected, not accessible via
// this app's own dedicated Postgres role). Shares the SAME single-
// flight coalescing as GET /auth/sso/session - a refresh triggered by
// one and a refresh triggered by the other, for the same sid at the
// same time, correctly coalesce into one call, never two.
export async function ensureValidAccessToken(sid, deps = {}) {
  const {
    getOAuthClientConfig = realGetOAuthClientConfig,
    refreshTokens = realRefreshTokens,
    verifyAccessTokenForClient = realVerifyAccessTokenForClient,
  } = deps;

  const cached = getCachedAccessToken(sid);
  if (cached) return cached;

  const record = getSsoSession(sid);
  if (!record) return null;

  let config;
  try {
    config = getOAuthClientConfig();
  } catch (err) {
    console.error('[ensureValidAccessToken] OAuth client is not configured:', err?.message ?? err);
    return null;
  }

  const outcome = await runSingleFlightRefresh(sid, () => performSessionRefresh(sid, record, config, deps));
  return outcome.ok ? outcome.accessToken : null;
}

export function createSsoRouter(deps = {}) {
  const {
    getOAuthClientConfig = realGetOAuthClientConfig,
    exchangeCodeForTokens = realExchangeCodeForTokens,
    refreshTokens = realRefreshTokens,
    verifyAccessTokenForClient = realVerifyAccessTokenForClient,
    frontendUrl = process.env.FRONTEND_URL,
  } = deps;

  if (!frontendUrl) {
    throw new Error('createSsoRouter: frontendUrl (or FRONTEND_URL) is required.');
  }

  const router = Router();

  router.get('/auth/sso/start', (req, res) => {
    let config;
    try {
      config = getOAuthClientConfig();
    } catch (err) {
      console.error('[sso/start] OAuth client is not configured:', err?.message ?? err);
      return redirectWithError(res, frontendUrl, 'config_error');
    }
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();
    const next = sanitizeReturnTo(req.query.return_to);
    // AUTH-003B security correction: a login-CSRF defense independent
    // of the OAuth `state` param itself - see ssoSession.js's own
    // comment on OAUTH_CSRF_COOKIE_NAME for the attack this closes.
    const csrfToken = generateState();
    createPendingAuthorization(state, { codeVerifier, next, csrfToken });
    res.setHeader('Set-Cookie', buildOauthCsrfCookieHeader(csrfToken));
    res.redirect(buildAuthorizationUrl(config, { state, codeChallenge }));
  });

  router.get('/auth/sso/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) {
      return redirectWithError(res, frontendUrl, 'denied');
    }
    if (!code || !state) {
      return redirectWithError(res, frontendUrl, 'invalid_state');
    }
    const pending = consumePendingAuthorization(state);
    if (!pending) {
      return redirectWithError(res, frontendUrl, 'invalid_state');
    }

    // AUTH-003B security correction: proves the browser completing this
    // callback is the SAME ONE that initiated /auth/sso/start - the
    // `state` param alone does not, since it is attacker-controlled
    // input that can be lifted from a captured callback URL. Without
    // this, a login-CSRF attack is possible: an attacker completes
    // their own consent, captures their own valid code+state, and
    // sends that exact callback URL to a victim, who would otherwise
    // be signed into the ATTACKER's account. See ssoSession.js's own
    // comment on OAUTH_CSRF_COOKIE_NAME.
    const csrfCookie = readOauthCsrfCookie(req.headers.cookie);
    if (!isValidState(csrfCookie, pending.csrfToken)) {
      console.error('[sso/callback] OAuth login-CSRF check failed: missing or mismatched tsm_oauth_csrf cookie.');
      return redirectWithError(res, frontendUrl, 'invalid_state');
    }

    let config;
    try {
      config = getOAuthClientConfig();
    } catch (err) {
      console.error('[sso/callback] OAuth client is not configured:', err?.message ?? err);
      return redirectWithError(res, frontendUrl, 'config_error');
    }

    let tokens;
    try {
      tokens = await exchangeCodeForTokens(config, { code, codeVerifier: pending.codeVerifier });
    } catch (err) {
      console.error('[sso/callback] Token exchange failed:', err instanceof OAuthProtocolError ? err.message : (err?.message ?? err));
      return redirectWithError(res, frontendUrl, 'token_exchange_failed');
    }

    let claims;
    try {
      claims = await verifyAccessTokenForClient(tokens.access_token, config);
    } catch (err) {
      console.error('[sso/callback] Access token verification failed:', err?.message ?? err);
      return redirectWithError(res, frontendUrl, 'verification_failed');
    }

    const { sid } = createSsoSession({ userId: claims.sub, email: claims.email, refreshToken: tokens.refresh_token });
    cacheAccessToken(sid, tokens.access_token, tokens.expires_in ?? 3600);
    const token = mintSessionToken(sid, claims.sub, claims.email);
    // Two distinct Set-Cookie headers in one response - Node/Express
    // support this via an array, each cookie name independent of the other.
    res.setHeader('Set-Cookie', [buildSessionCookieHeader(token), buildClearOauthCsrfCookieHeader()]);
    res.redirect(`${frontendUrl}${pending.next}`);
  });

  router.get('/auth/sso/session', async (req, res) => {
    const cookie = readSessionCookie(req.headers.cookie);
    if (!cookie) {
      return res.json({ authenticated: false });
    }

    try {
      const payload = verifySessionToken(cookie);
      if (isSessionActive(payload.sid)) {
        return res.json({ authenticated: true, email: payload.email ?? null });
      }
      res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
      return res.json({ authenticated: false });
    } catch (err) {
      if (!(err instanceof InvalidSessionTokenError)) throw err;
    }

    let expiredPayload;
    try {
      expiredPayload = verifySessionToken(cookie, { allowExpired: true });
    } catch {
      res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
      return res.json({ authenticated: false });
    }

    const record = getSsoSession(expiredPayload.sid);
    if (!record) {
      res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
      return res.json({ authenticated: false });
    }

    let config;
    try {
      config = getOAuthClientConfig();
    } catch (err) {
      console.error('[sso/session] OAuth client is not configured for refresh:', err?.message ?? err);
      res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
      return res.json({ authenticated: false });
    }

    const outcome = await runSingleFlightRefresh(expiredPayload.sid, () =>
      performSessionRefresh(expiredPayload.sid, record, config, { refreshTokens, verifyAccessTokenForClient })
    );
    if (outcome.ok) {
      res.setHeader('Set-Cookie', buildSessionCookieHeader(outcome.token));
      return res.json({ authenticated: true, email: outcome.email ?? null });
    }
    res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
    return res.json({ authenticated: false });
  });

  router.post('/auth/sso/logout', (req, res) => {
    // AUTH-003B security correction: this route has no JSON body and
    // no non-simple method, so (unlike the strategies proxy's
    // POST/PATCH/DELETE, whose JSON Content-Type or method already
    // forces a CORS preflight) a plain cross-site <form method="POST">
    // or bodyless fetch would otherwise reach this handler with the
    // SameSite=None session cookie attached - a login-CSRF-shaped
    // "forced logout." Requiring a custom header forces a preflight
    // for script-based attempts (app.js's CORS only allows the real
    // frontend origin), and a plain HTML form cannot set custom
    // headers at all, so this also blocks the form vector outright.
    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return res.status(403).json({ error: { message: 'Missing required header.' } });
    }
    const cookie = readSessionCookie(req.headers.cookie);
    if (cookie) {
      try {
        const payload = verifySessionToken(cookie, { allowExpired: true });
        deleteSsoSession(payload.sid);
      } catch {
        // malformed/forged - nothing valid to delete.
      }
    }
    res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
    res.json({ success: true });
  });

  return router;
}
