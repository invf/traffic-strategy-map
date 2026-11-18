// AUTH-003B - the frontend's own view of the SSO session established
// by backend/routes/ssoRoutes.js. The browser never sees an OAuth
// access/refresh token at any point - only this app's own opaque,
// HttpOnly session cookie, which these calls rely on implicitly (via
// apiFetch's credentials: 'include'). There is nothing to store here
// beyond what GET /auth/sso/session itself reports.
import { apiFetch, getApiUrl } from '../lib/api';

export async function fetchSsoSession() {
  try {
    const res = await apiFetch('/auth/sso/session');
    if (!res.ok) return { authenticated: false };
    return await res.json();
  } catch {
    // Backend unreachable/misconfigured - treat exactly like "signed
    // out," never like "signed in," so no private UI is ever shown on
    // a guess.
    return { authenticated: false };
  }
}

// Not an apiFetch call - this is a full top-level navigation (the
// browser must actually follow the OAuth redirect chain), not a fetch
// the frontend can intercept and read the response of.
export function buildSignInUrl(returnTo) {
  const url = new URL(`${getApiUrl()}/auth/sso/start`);
  url.searchParams.set('return_to', returnTo || `${window.location.pathname}${window.location.search}`);
  return url.toString();
}

export async function signOut() {
  await apiFetch('/auth/sso/logout', { method: 'POST' });
}
