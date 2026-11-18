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
// ONE REAL ADAPTATION from Launch Studio's version, not a copy-paste:
// Launch Studio is a monolith (one origin serves both frontend and
// API), so its cookie uses SameSite=Lax. Traffic Strategy Map's
// frontend (Vercel) and backend (Render) are genuinely different
// origins - SameSite=Lax would NOT be sent on the frontend's own
// cross-origin fetch() calls to this backend. This cookie uses
// SameSite=None (which browsers require to be paired with Secure) -
// correct for this split architecture, not a stylistic choice.
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

export function readSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SSO_COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

// SameSite=None + Secure unconditionally - this is cross-origin by
// architecture (Vercel frontend, Render backend), not just in
// production. A real browser will refuse SameSite=None without
// Secure, so local HTTP-only testing of the full cross-origin cookie
// flow isn't possible without HTTPS - the route logic itself is tested
// directly (supertest), not through two real browser origins.
export function buildSessionCookieHeader(token) {
  return `${SSO_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`;
}
export function buildClearSessionCookieHeader() {
  return `${SSO_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
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
