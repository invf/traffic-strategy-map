// AUTH-003B - Traffic Strategy Map's OWN first-party session,
// established after a successful OAuth 2.1 code exchange with the
// shared Supabase project. Ported from invf/adveser-launch-studio's
// server/auth/oauth/ssoSession.ts, which is proven in production -
// including both of its AUTH-001 Phase 4B hardening fixes (the
// concurrent-refresh race fix, and the logout-invalidation fix). Not
// reinvented from scratch; same reasoning applies here unchanged:
//
// This is deliberately NOT a Supabase session handed to the browser,
// and NOT passed through supabase-js's setSession() - this ticket's
// own instruction is explicit: "Build the integration without
// assuming that setSession() compatibility has already been proven...
// Keep the session mechanism replaceable." OAuth access/refresh tokens
// never leave this server; the browser holds only an opaque, HttpOnly,
// first-party cookie signed with a secret only this server knows.
//
// ARCHITECTURE: AUTH-003B's pre-production audit found that
// SameSite=None (needed while frontend and backend were on genuinely
// different origins - Vercel vs. Render) does NOT make this cookie
// reliable everywhere: Safari blocks ALL third-party cookies
// unconditionally (no SameSite=None exception exists), and Firefox's
// default Total Cookie Protection partitions storage per top-level
// site, so a cookie set while the backend is briefly the top-level
// site (during the OAuth redirect) is invisible to a later cross-site
// fetch from the frontend. Only default Chrome worked reliably under
// that shape. See docs/AUTH_003B_PRE_PRODUCTION_AUDIT.md.
//
// DECIDED FIX (Option B, approved): traffic-map.adveser.com reverse-
// proxies /api/* and /auth/* to the Render backend (vercel.json) -
// frontend and backend are now the SAME site from every browser's
// perspective, same as Launch Studio's monolith. SameSite=Lax is the
// default accordingly (real CSRF protection, not just "the minimum
// needed to survive being cross-origin"). TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=None
// remains available as an explicit rollback switch for an emergency
// revert to the old split-origin shape (e.g. the proxy is temporarily
// unavailable) - kept configurable, not re-hardcoded, for exactly that
// reason.
//
// In-memory session-record store: same documented trade-off as
// Launch Studio - a process restart drops in-flight SSO sessions;
// affected users simply redo the SSO redirect.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { generateState } from './pkce.js';

export const SSO_COOKIE_NAME = 'tsm_sso_session';
export const SESSION_TOKEN_LIFETIME_SECONDS = 15 * 60;
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export class InvalidSessionTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidSessionTokenError';
  }
}

function getSigningSecret() {
  const secret = process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET;
  if (!secret) {
    throw new Error("TRAFFIC_STRATEGY_MAP_SESSION_SECRET is not configured - required to issue/verify this app's own SSO session cookie.");
  }
  return secret;
}

function base64UrlEncode(input) {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(input) {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function hmac(payloadB64, secret) {
  return base64UrlEncode(createHmac('sha256', secret).update(payloadB64).digest());
}

// 2-part (payload.signature), not 3-part JWT-shaped - never mistaken
// for a real Supabase token anywhere in this codebase or a log.
export function signSessionToken(payload) {
  const secret = getSigningSecret();
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${hmac(payloadB64, secret)}`;
}

export function verifySessionToken(token, options = {}) {
  const secret = getSigningSecret();
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new InvalidSessionTokenError('Malformed session token.');
  }
  const [payloadB64, signature] = parts;
  const expected = hmac(payloadB64, secret);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidSessionTokenError('Session token signature is invalid.');
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new InvalidSessionTokenError('Session token payload is malformed.');
  }

  if (!options.allowExpired && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new InvalidSessionTokenError('Session token has expired.');
  }
  return payload;
}

// Generic cookie-by-name reader, used for both this app's session
// cookie and (AUTH-003B security correction, see below) its separate
// OAuth login-CSRF cookie.
export function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const cookieName = part.slice(0, eq).trim();
    if (cookieName === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function readSessionCookie(cookieHeader) {
  return readCookie(cookieHeader, SSO_COOKIE_NAME);
}

// Defaults to Lax - correct now that frontend and backend are same-
// site via the Vercel reverse proxy (see this file's own header
// comment). Set TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE=None only as an
// explicit, temporary rollback to the old split-origin shape. An
// invalid value fails closed to 'Lax' (the current correct default),
// never to the weaker 'None', and never produces a malformed
// Set-Cookie header.
function getCookieSameSite() {
  const value = process.env.TRAFFIC_STRATEGY_MAP_COOKIE_SAMESITE;
  if (value === 'None' || value === 'Strict') return value;
  return 'Lax';
}

// Secure unconditionally - required by every browser whenever
// SameSite=None is used, and simply correct regardless of SameSite
// otherwise (this app is never served over plain HTTP). A real browser
// will refuse SameSite=None without Secure, so local HTTP-only testing
// of the full cross-origin cookie flow isn't possible without HTTPS -
// the route logic itself is tested directly (supertest), not through
// two real browser origins.
export function buildSessionCookieHeader(token) {
  return `${SSO_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=${getCookieSameSite()}; Secure; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`;
}
export function buildClearSessionCookieHeader() {
  return `${SSO_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${getCookieSameSite()}; Secure; Max-Age=0`;
}

// AUTH-003B security correction (pre-production audit): a separate,
// short-lived cookie set at /auth/sso/start and checked at
// /auth/sso/callback - the OAuth login-CSRF defense. Without this, the
// `state` parameter alone does not prove the SAME BROWSER that started
// the flow is the one completing it: pkce.js's isValidState() was
// imported for exactly this comparison but was never actually wired
// up anywhere, so nothing enforced it. An attacker can complete their
// OWN consent, capture the resulting `code`+`state` from their own
// browser, and hand that exact callback URL to a victim - without this
// cookie, the backend has no way to tell that replay apart from a
// genuine completion, and would sign the victim into the attacker's
// account (a classic "login CSRF").
//
// SameSite=Lax (not None) is correct and sufficient here, unlike the
// session cookie: it only needs to survive a TOP-LEVEL GET navigation
// returning from Supabase's redirect chain, which Lax already allows -
// it is never read via a cross-site fetch/XHR the way the session
// cookie is, so it needs no broader exposure.
export const OAUTH_CSRF_COOKIE_NAME = 'tsm_oauth_csrf';
const OAUTH_CSRF_COOKIE_MAX_AGE_SECONDS = 10 * 60; // matches ssoState.js's pending-authorization TTL

export function readOauthCsrfCookie(cookieHeader) {
  return readCookie(cookieHeader, OAUTH_CSRF_COOKIE_NAME);
}
export function buildOauthCsrfCookieHeader(token) {
  return `${OAUTH_CSRF_COOKIE_NAME}=${token}; Path=/auth/sso; HttpOnly; SameSite=Lax; Secure; Max-Age=${OAUTH_CSRF_COOKIE_MAX_AGE_SECONDS}`;
}
export function buildClearOauthCsrfCookieHeader() {
  return `${OAUTH_CSRF_COOKIE_NAME}=; Path=/auth/sso; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

// ---- Server-side session record store ----
// accessToken/accessTokenExpiresAt: AUTH-003B addition, not in Launch
// Studio's original - Traffic Strategy Map's public.strategies is RLS-
// protected (unlike Launch Studio's own direct-Postgres-role access),
// so the backend needs the user's REAL Supabase access token to relay
// PostgREST calls on their behalf (backend/routes/strategiesProxy.js) -
// never handed to the browser, cached here only long enough to avoid
// refreshing on every single request. See getValidAccessToken below.
let store = new Map(); // sid -> { userId, email, refreshToken, accessToken?, accessTokenExpiresAt? }

export function __resetSsoSessionStoreForTests() {
  store = new Map();
}

export function createSsoSession(record) {
  const sid = generateState();
  store.set(sid, record);
  return { sid };
}
export function getSsoSession(sid) {
  return store.get(sid);
}
export function updateSsoSessionRefreshToken(sid, refreshToken) {
  const record = store.get(sid);
  if (record) record.refreshToken = refreshToken;
}
export function cacheAccessToken(sid, accessToken, expiresInSeconds) {
  const record = store.get(sid);
  if (record) {
    record.accessToken = accessToken;
    // A safety margin so a token that's "valid" by a few seconds
    // doesn't expire mid-request against PostgREST.
    record.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds - 30;
  }
}
export function getCachedAccessToken(sid) {
  const record = store.get(sid);
  if (!record || !record.accessToken || !record.accessTokenExpiresAt) return null;
  if (record.accessTokenExpiresAt <= Math.floor(Date.now() / 1000)) return null;
  return record.accessToken;
}
export function deleteSsoSession(sid) {
  store.delete(sid);
}
export function mintSessionToken(sid, userId, email) {
  return signSessionToken({ sid, sub: userId, email, exp: Math.floor(Date.now() / 1000) + SESSION_TOKEN_LIFETIME_SECONDS });
}

// AUTH-001 Phase 4B (ported): signature+exp validity alone is NOT
// proof of an active session - logout (or a restart) deletes this
// sid's record, and a token minted before that point is otherwise
// still valid for the rest of its lifetime window. Every place that
// accepts a non-expired token as authenticating a request MUST also
// call this - see this file's exports used in requireSsoAuth.js and
// ssoRoutes.js's own strict branch.
export function isSessionActive(sid) {
  return store.has(sid);
}

// ---- Single-flight refresh coalescing (AUTH-001 Phase 4B, ported) ----
const inFlightRefreshes = new Map();

export function runSingleFlightRefresh(sid, operation) {
  const existing = inFlightRefreshes.get(sid);
  if (existing) return existing;
  const promise = operation().finally(() => {
    inFlightRefreshes.delete(sid);
  });
  inFlightRefreshes.set(sid, promise);
  return promise;
}
export function __resetInFlightRefreshesForTests() {
  inFlightRefreshes.clear();
}
