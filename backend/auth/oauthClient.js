// AUTH-003B - the OAuth 2.1 client calls themselves: build the
// authorize URL, exchange a code for tokens, refresh tokens, verify an
// access token's claims. Same protocol shape already proven working
// for invf/adveser-launch-studio - reused, not reinvented. Mirrors
// backend/middleware/requireAuth.js's own JWKS verification for the
// "verify" half, so there is exactly one place this project decides
// how to verify a token against this project's JWKS.

import { createRemoteJWKSet, jwtVerify } from 'jose';

export class OAuthProtocolError extends Error {
  constructor(code, description) {
    super(description || code);
    this.name = 'OAuthProtocolError';
    this.code = code;
  }
}

export function getOAuthClientConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const clientId = process.env.TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID;
  const clientSecret = process.env.TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.TRAFFIC_STRATEGY_MAP_OAUTH_REDIRECT_URI;
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!clientId) missing.push('TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_ID');
  if (!clientSecret) missing.push('TRAFFIC_STRATEGY_MAP_OAUTH_CLIENT_SECRET');
  if (!redirectUri) missing.push('TRAFFIC_STRATEGY_MAP_OAUTH_REDIRECT_URI');
  if (missing.length) {
    throw new Error(`OAuth client is not configured - missing: ${missing.join(', ')}.`);
  }
  return {
    authorizeEndpoint: `${supabaseUrl}/auth/v1/oauth/authorize`,
    tokenEndpoint: `${supabaseUrl}/auth/v1/oauth/token`,
    jwksUri: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    issuer: `${supabaseUrl}/auth/v1`,
    clientId,
    clientSecret,
    redirectUri,
    scope: 'openid email',
  };
}

export function buildAuthorizationUrl(config, { state, codeChallenge }) {
  const url = new URL(config.authorizeEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('scope', config.scope);
  return url.toString();
}

async function tokenRequest(config, body) {
  const res = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new OAuthProtocolError(data.error || 'token_request_failed', data.error_description);
  }
  return data;
}

export async function exchangeCodeForTokens(config, { code, codeVerifier }) {
  return tokenRequest(config, { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: codeVerifier });
}

export async function refreshTokens(config, { refreshToken }) {
  return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

export class AccessTokenVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessTokenVerificationError';
  }
}

let cachedJwks;
let cachedJwksUri;
function getJwks(jwksUri) {
  if (!cachedJwks || cachedJwksUri !== jwksUri) {
    cachedJwks = createRemoteJWKSet(new URL(jwksUri));
    cachedJwksUri = jwksUri;
  }
  return cachedJwks;
}

export async function verifyAccessTokenForClient(accessToken, config) {
  try {
    const { payload } = await jwtVerify(accessToken, getJwks(config.jwksUri), { issuer: config.issuer, audience: 'authenticated' });
    if (!payload.sub) throw new AccessTokenVerificationError('Token has no subject claim.');
    if (payload.client_id !== config.clientId) throw new AccessTokenVerificationError('Token was not issued to this client.');
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
  } catch (err) {
    if (err instanceof AccessTokenVerificationError) throw err;
    throw new AccessTokenVerificationError('Access token failed verification.');
  }
}
