// AUTH-003B - frontend client for the authenticated strategies proxy
// (backend/routes/strategiesProxy.js), replacing the previous direct
// supabase-js calls in StrategiesModal.jsx. The backend - not this
// module - holds the real Supabase access token and relays these
// calls to PostgREST on the signed-in user's behalf; this module only
// ever talks to this app's own backend, authenticated via the SSO
// cookie (apiFetch's credentials: 'include').
import { apiFetch } from '../lib/api';
import { errorKeyForStatus } from '../lib/apiErrors';

export { errorKeyForStatus };

export class StrategiesApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'StrategiesApiError';
    this.status = status;
  }
}

async function parseOrThrow(res) {
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `Request failed (${res.status})`;
    throw new StrategiesApiError(res.status, message);
  }
  return data;
}

export async function listStrategies() {
  const res = await apiFetch('/api/strategies');
  return parseOrThrow(res);
}

export async function getStrategy(id) {
  const res = await apiFetch(`/api/strategies/${id}`);
  return parseOrThrow(res);
}

export async function createStrategy({ name, nodes, edges, productInfo, aiSuggestions }) {
  const res = await apiFetch('/api/strategies', {
    method: 'POST',
    body: JSON.stringify({ name, nodes, edges, product_info: productInfo, ai_suggestions: aiSuggestions }),
  });
  return parseOrThrow(res);
}

export async function deleteStrategy(id) {
  const res = await apiFetch(`/api/strategies/${id}`, { method: 'DELETE' });
  return parseOrThrow(res);
}
