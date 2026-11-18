// AUTH-003B - the one place that knows how to reach this app's own
// backend. `credentials: 'include'` is required on every call, not
// just the SSO routes themselves: the backend authenticates the
// browser via its first-party SSO cookie, which fetch() only ever
// sends cross-origin when credentials are explicitly included -
// omitting it on any one call would silently turn that call into an
// unauthenticated request instead of a 401. Same-origin requests send
// the cookie regardless, but including it unconditionally means this
// code works correctly in both deployment shapes without a branch.
//
// AUTH-003B same-origin proxy (Option B): VITE_API_URL is now OPTIONAL
// and local-dev-only. In production, this is unset and every call
// below resolves to a RELATIVE path (`${''}${path}` === path) - the
// browser's own fetch() resolves that against the current page's
// origin, which is the public frontend domain. vercel.json's rewrites
// then transparently proxy /api/* and /auth/* to the real Render
// backend, so the browser never contacts a different origin at all -
// this is what makes the session cookie reliable across every browser
// (see docs/AUTH_003B_PRE_PRODUCTION_AUDIT.md's cross-origin findings;
// SameSite alone never fixed this). Set VITE_API_URL to an absolute
// URL (e.g. http://localhost:3001) only for local development without
// a configured reverse proxy in front of the frontend dev server.
const API_URL = import.meta.env.VITE_API_URL || '';

export function getApiUrl() {
  return API_URL;
}

// Resolves a path the same way fetch() would, but as a real absolute
// URL - needed for anything that isn't itself a fetch() call, i.e. the
// OAuth sign-in link's top-level navigation (buildSignInUrl in
// services/auth.js), where `new URL(path)` would throw on a bare
// relative path with no base.
export function resolveApiUrl(path) {
  if (API_URL) return `${API_URL}${path}`;
  return `${window.location.origin}${path}`;
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

// Shared by every caller of the protected /api/openai endpoint
// (services/openai.js, services/agent.js, services/postStudio.js) -
// previously each had its own hand-rolled fetch that was missing
// `credentials: 'include'` entirely (agent.js, postStudio.js), which
// would have silently 401'd every request once requireSsoAuth went
// live, with no indication why. One implementation now, so this
// cannot regress independently in three places again.
export async function callOpenAiProxy(body) {
  const requestInit = {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  let res = await fetch(`${API_URL}/api/openai`, requestInit);
  if (res.status === 401) {
    const session = await refreshSsoSession();
    if (session.authenticated) res = await fetch(`${API_URL}/api/openai`, requestInit);
  }
  return res;
}

export async function apiFetch(path, options = {}) {
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
