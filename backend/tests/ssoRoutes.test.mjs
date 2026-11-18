// AUTH-003B - full HTTP-level integration tests for the SSO router, via
// supertest against a real Express app - no real Supabase project or
// network call: exchangeCodeForTokens/refreshTokens/
// verifyAccessTokenForClient/getOAuthClientConfig are all injected
// fakes (createSsoRouter's own DI point). Mirrors
// invf/adveser-launch-studio's own proven ssoRoutes.test.ts harness.
// Run with: node backend/tests/ssoRoutes.test.mjs

import express from 'express';
import request from 'supertest';
import { createSsoRouter } from '../routes/ssoRoutes.js';
import { OAuthProtocolError, AccessTokenVerificationError } from '../auth/oauthClient.js';
import { getSsoSession, __resetSsoSessionStoreForTests, createSsoSession, mintSessionToken, signSessionToken, SSO_COOKIE_NAME } from '../auth/ssoSession.js';
import { __resetPendingAuthorizationsForTests } from '../auth/ssoState.js';

process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET = process.env.TRAFFIC_STRATEGY_MAP_SESSION_SECRET || 'test-only-session-secret-do-not-use-in-production';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log(`[PASS] ${message}`); }
  else { failed++; console.error(`[FAIL] ${message}`); }
}

const FAKE_CONFIG = {
  authorizeEndpoint: 'https://fake-project.supabase.co/auth/v1/oauth/authorize',
  tokenEndpoint: 'https://fake-project.supabase.co/auth/v1/oauth/token',
  clientId: 'fake-client-id',
  clientSecret: 'fake-client-secret',
  redirectUri: 'https://traffic-strategy-backend.example.com/auth/sso/callback',
  scope: 'openid email',
  jwksUri: 'https://fake-project.supabase.co/auth/v1/.well-known/jwks.json',
  issuer: 'https://fake-project.supabase.co/auth/v1',
};

function makeApp(deps) {
  const app = express();
  app.use(createSsoRouter({ frontendUrl: 'https://frontend.example.com', ...deps }));
  return app;
}

function fakeDeps(overrides = {}) {
  return {
    getOAuthClientConfig: () => FAKE_CONFIG,
    exchangeCodeForTokens: async () => ({ access_token: 'fake-access-token', token_type: 'bearer', expires_in: 3600, refresh_token: 'fake-refresh-token-v1' }),
    refreshTokens: async () => ({ access_token: 'fake-access-token-v2', token_type: 'bearer', expires_in: 3600, refresh_token: 'fake-refresh-token-v2' }),
    verifyAccessTokenForClient: async () => ({ sub: 'canonical-user-id', email: 'user@example.com' }),
    ...overrides,
  };
}

function extractStateFromRedirect(location) {
  const url = new URL(location);
  const state = url.searchParams.get('state');
  if (!state) throw new Error('No state in redirect URL - test setup is broken.');
  return state;
}

async function run() {
  // ===== /auth/sso/start =====
  {
    __resetPendingAuthorizationsForTests();
    const app = makeApp(fakeDeps());
    const res = await request(app).get('/auth/sso/start');
    assert(res.status === 302, 'start: redirects (302) to the authorization endpoint');
    const location = res.headers.location;
    assert(location.startsWith(FAKE_CONFIG.authorizeEndpoint), 'start: redirect target is the configured authorizeEndpoint');
    const url = new URL(location);
    assert(url.searchParams.get('response_type') === 'code', 'start: response_type=code');
    assert(url.searchParams.get('client_id') === FAKE_CONFIG.clientId, 'start: correct client_id');
    assert(url.searchParams.get('code_challenge_method') === 'S256', 'start: code_challenge_method=S256');
    assert(!!url.searchParams.get('code_challenge'), 'start: a code_challenge is present');
    assert(!!url.searchParams.get('state'), 'start: a state value is present');
    assert(!location.includes(FAKE_CONFIG.clientSecret), 'start: the client secret never appears in the browser-facing redirect URL');
  }

  // ===== /auth/sso/start - config missing =====
  {
    const app = makeApp(fakeDeps({ getOAuthClientConfig: () => { throw new Error('not configured'); } }));
    const res = await request(app).get('/auth/sso/start');
    assert(res.status === 302 && res.headers.location === 'https://frontend.example.com/?sso_error=config_error', 'start: a config error redirects to the FRONTEND (not this backend) with sso_error=config_error');
  }

  // ===== /auth/sso/callback - denied consent =====
  {
    let exchangeCalled = false;
    const app = makeApp(fakeDeps({ exchangeCodeForTokens: async () => { exchangeCalled = true; throw new Error('should never be called'); } }));
    const res = await request(app).get('/auth/sso/callback?error=access_denied');
    assert(res.status === 302 && res.headers.location === 'https://frontend.example.com/?sso_error=denied', 'callback: a denied-consent error redirects to the frontend with sso_error=denied');
    assert(!exchangeCalled, 'callback: the token endpoint is NEVER called when the user denied consent');
  }

  // ===== /auth/sso/callback - invalid/missing state =====
  {
    const app = makeApp(fakeDeps());
    const res = await request(app).get('/auth/sso/callback?code=some-code&state=never-issued-state');
    assert(res.status === 302 && res.headers.location === 'https://frontend.example.com/?sso_error=invalid_state', 'callback: an unknown/forged state redirects with sso_error=invalid_state');
    const res2 = await request(app).get('/auth/sso/callback?code=some-code');
    assert(res2.status === 302 && res2.headers.location === 'https://frontend.example.com/?sso_error=invalid_state', 'callback: a MISSING state redirects with sso_error=invalid_state too');
  }

  // ===== Happy path: start -> callback establishes a session cookie, redirects to the FRONTEND =====
  {
    __resetPendingAuthorizationsForTests();
    __resetSsoSessionStoreForTests();
    const app = makeApp(fakeDeps());
    const startRes = await request(app).get('/auth/sso/start?return_to=%2Fdashboard');
    const state = extractStateFromRedirect(startRes.headers.location);

    const callbackRes = await request(app).get(`/auth/sso/callback?code=a-fresh-code&state=${state}`);
    assert(callbackRes.status === 302, 'callback happy path: redirects');
    assert(callbackRes.headers.location === 'https://frontend.example.com/dashboard', 'callback happy path: redirects to the FRONTEND origin + the original return_to path, not this backend');
    const setCookie = callbackRes.headers['set-cookie'] ?? [];
    assert(setCookie.some((c) => c.startsWith(`${SSO_COOKIE_NAME}=`)), 'callback happy path: sets the SSO session cookie');
    assert(setCookie.some((c) => c.includes('HttpOnly')), 'callback happy path: the cookie is HttpOnly');
    assert(setCookie.some((c) => c.includes('SameSite=None') && c.includes('Secure')), 'callback happy path: the cookie is SameSite=None; Secure - required for this cross-origin (Vercel/Render) architecture, unlike Launch Studio\'s own SameSite=Lax monolith cookie');
    assert(!setCookie.some((c) => c.includes('fake-access-token') || c.includes('fake-refresh-token')), 'callback happy path: the RAW OAuth access/refresh tokens never appear in the cookie value');
  }

  // ===== Reused state is rejected =====
  {
    __resetPendingAuthorizationsForTests();
    __resetSsoSessionStoreForTests();
    const app = makeApp(fakeDeps());
    const startRes = await request(app).get('/auth/sso/start');
    const state = extractStateFromRedirect(startRes.headers.location);
    const first = await request(app).get(`/auth/sso/callback?code=a-code&state=${state}`);
    assert(first.status === 302 && first.headers.location === 'https://frontend.example.com/', 'reuse test: the FIRST callback with this state succeeds');
    const second = await request(app).get(`/auth/sso/callback?code=a-code&state=${state}`);
    assert(second.status === 302 && second.headers.location === 'https://frontend.example.com/?sso_error=invalid_state', 'reuse test: REPLAYING the exact same callback URL is rejected');
  }

  // ===== Token exchange failure =====
  {
    __resetPendingAuthorizationsForTests();
    const app = makeApp(fakeDeps({ exchangeCodeForTokens: async () => { throw new OAuthProtocolError('invalid_grant', 'Code has expired.'); } }));
    const startRes = await request(app).get('/auth/sso/start');
    const state = extractStateFromRedirect(startRes.headers.location);
    const res = await request(app).get(`/auth/sso/callback?code=expired-code&state=${state}`);
    assert(res.status === 302 && res.headers.location === 'https://frontend.example.com/?sso_error=token_exchange_failed', 'callback: a token-endpoint failure redirects with sso_error=token_exchange_failed');
  }

  // ===== Verification failure =====
  {
    __resetPendingAuthorizationsForTests();
    const app = makeApp(fakeDeps({ verifyAccessTokenForClient: async () => { throw new AccessTokenVerificationError('Access token failed verification.'); } }));
    const startRes = await request(app).get('/auth/sso/start');
    const state = extractStateFromRedirect(startRes.headers.location);
    const res = await request(app).get(`/auth/sso/callback?code=a-code&state=${state}`);
    assert(res.status === 302 && res.headers.location === 'https://frontend.example.com/?sso_error=verification_failed', 'callback: a verification failure redirects with sso_error=verification_failed, never establishes a session');
  }

  // ===== GET /auth/sso/session =====
  {
    const app = makeApp(fakeDeps());
    const res = await request(app).get('/auth/sso/session');
    assert(res.status === 200 && res.body.authenticated === false, 'session: no cookie -> authenticated:false');
  }
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-a', email: 'a@example.com', refreshToken: 'rt-a' });
    const token = mintSessionToken(sid, 'user-a', 'a@example.com');
    const app = makeApp(fakeDeps());
    const res = await request(app).get('/auth/sso/session').set('Cookie', `${SSO_COOKIE_NAME}=${token}`);
    assert(res.status === 200 && res.body.authenticated === true && res.body.email === 'a@example.com', 'session: a valid, non-expired cookie -> authenticated:true');
  }

  // ===== GET /auth/sso/session - expired cookie, successful silent refresh =====
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-b', email: 'b@example.com', refreshToken: 'rt-b-v1' });
    const expiredToken = signSessionToken({ sid, sub: 'user-b', email: 'b@example.com', exp: Math.floor(Date.now() / 1000) - 10 });
    const app = makeApp(fakeDeps());
    const res = await request(app).get('/auth/sso/session').set('Cookie', `${SSO_COOKIE_NAME}=${expiredToken}`);
    assert(res.status === 200 && res.body.authenticated === true, 'session: an expired cookie with a still-valid server-side record is silently refreshed');
    assert(getSsoSession(sid)?.refreshToken === 'fake-refresh-token-v2', 'session: refresh ROTATION - the record now holds the NEW refresh token');
  }

  // ===== GET /auth/sso/session - refresh fails =====
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-c', email: 'c@example.com', refreshToken: 'rt-c-revoked' });
    const expiredToken = signSessionToken({ sid, sub: 'user-c', email: 'c@example.com', exp: Math.floor(Date.now() / 1000) - 10 });
    const app = makeApp(fakeDeps({ refreshTokens: async () => { throw new OAuthProtocolError('invalid_grant', 'Refresh token has been revoked.'); } }));
    const res = await request(app).get('/auth/sso/session').set('Cookie', `${SSO_COOKIE_NAME}=${expiredToken}`);
    assert(res.status === 200 && res.body.authenticated === false, 'session: a revoked refresh token results in authenticated:false');
    assert(getSsoSession(sid) === undefined, 'session: the local session record is torn down on refresh failure');
  }

  // ===== POST /auth/sso/logout =====
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-d', email: 'd@example.com', refreshToken: 'rt-d' });
    const token = mintSessionToken(sid, 'user-d', 'd@example.com');
    const app = makeApp(fakeDeps());
    const res = await request(app).post('/auth/sso/logout').set('Cookie', `${SSO_COOKIE_NAME}=${token}`);
    assert(res.status === 200 && res.body.success === true, 'logout: returns success');
    assert(getSsoSession(sid) === undefined, 'logout: deletes the server-side session record');
  }
  {
    const app = makeApp(fakeDeps());
    const res = await request(app).post('/auth/sso/logout');
    assert(res.status === 200 && res.body.success === true, 'logout: calling logout with no session at all is a safe no-op');
  }

  // ===== AUTH-001 Phase 4B (ported): a reused cookie after logout is rejected =====
  {
    __resetSsoSessionStoreForTests();
    const { sid } = createSsoSession({ userId: 'user-e', email: 'e@example.com', refreshToken: 'rt-e' });
    const token = mintSessionToken(sid, 'user-e', 'e@example.com');
    const app = makeApp(fakeDeps());
    await request(app).post('/auth/sso/logout').set('Cookie', `${SSO_COOKIE_NAME}=${token}`);
    const res = await request(app).get('/auth/sso/session').set('Cookie', `${SSO_COOKIE_NAME}=${token}`);
    assert(res.status === 200 && res.body.authenticated === false, 'The SAME still-cryptographically-valid cookie, reused after logout, reports authenticated:false - signature+exp validity alone does not imply an active session (the fix this engagement already proved necessary for Launch Studio, ported here from the start)');
  }

  console.log(`\n=== TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  if (failed > 0) process.exit(1);
}

run();
