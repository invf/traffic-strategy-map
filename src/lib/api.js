// AUTH-003B - the one place that knows how to reach this app's own
// backend. `credentials: 'include'` is required on every call, not
// just the SSO routes themselves: the backend authenticates the
// browser via its first-party SSO cookie (SameSite=None; Secure),
// which fetch() only ever sends cross-origin when credentials are
// explicitly included - omitting it on any one call would silently
// turn that call into an unauthenticated request instead of a 401.
const API_URL = import.meta.env.VITE_API_URL;

export const isApiConfigured = !!API_URL;

export function getApiUrl() {
  return API_URL;
}

// AUTH-003B pre-production audit finding: the session cookie lives 15
// minutes (backend/auth/ssoSession.js's SESSION_TOKEN_LIFETIME_SECONDS)
// and nothing refreshes it in the background - a tab left open longer
// than that, with no reload in between, would otherwise 401 on its
// next save/load/AI request even though the underlying OAuth refresh
// token is still perfectly valid. GET /auth/sso/session already knows
// how to silently refresh-and-reissue the cookie server-side (that's
// its whole job on page load); this just also calls it from exactly
// the one place a stale cookie would otherwise surface as a dead end.
export async function refreshSsoSession() {
  try {
    const res = await fetch(`${API_URL}/auth/sso/session`, { credentials: 'include' });
    if (!res.ok) return { authenticated: false };
    return await res.json();
  } catch {
    return { authenticated: false };
  }
}

export async function apiFetch(path, options = {}) {
  if (!API_URL) throw new Error('VITE_API_URL not set in .env');
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

  const res = await doFetch();
  // Exactly one retry, and never for the session-check call itself
  // (which would recurse into refreshSsoSession() calling itself).
  // A 401 here means the session cookie was expired/invalid at request
  // time - not every entitlement/auth failure is a 401 (403/429/503
  // are real, final answers from an otherwise-valid session and must
  // never be retried).
  if (res.status === 401 && path !== '/auth/sso/session') {
    const session = await refreshSsoSession();
    if (session.authenticated) return doFetch();
  }
  return res;
}
