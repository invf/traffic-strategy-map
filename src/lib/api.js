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

export async function apiFetch(path, options = {}) {
  if (!API_URL) throw new Error('VITE_API_URL not set in .env');
  return fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}
