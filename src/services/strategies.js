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
  constructor(status, message, data = null) {
    super(message);
    this.name = 'StrategiesApiError';
    this.status = status;
    // AUTH-004: the full parsed error body, so a 409's `current` row
    // (the server's latest version, see backend/routes/strategiesProxy.js's
    // PATCH handler) reaches the caller without a second request - used
    // by the conflict-resolution UI in StrategiesModal.jsx.
    this.data = data;
  }
}

async function parseOrThrow(res) {
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `Request failed (${res.status})`;
    throw new StrategiesApiError(res.status, message, data);
  }
  return data;
}

// AUTH-004: centralizes the snake_case (backend/PostgREST) <-> camelCase
// (store/components) translation that was previously done ad hoc at the
// StrategiesModal.jsx call site - the new updateStrategy() needs the
// same mapping, so it belongs here once rather than twice.
function toCamelStrategy(row) {
  if (!row) return row;
  const { product_info, ai_suggestions, updated_at, ...rest } = row;
  return { ...rest, productInfo: product_info, aiSuggestions: ai_suggestions, updatedAt: updated_at };
}

export async function listStrategies() {
  const res = await apiFetch('/api/strategies');
  const data = await parseOrThrow(res);
  return (data || []).map(toCamelStrategy);
}

export async function getStrategy(id) {
  const res = await apiFetch(`/api/strategies/${id}`);
  return toCamelStrategy(await parseOrThrow(res));
}

export async function createStrategy({ name, nodes, edges, productInfo, aiSuggestions }) {
  const res = await apiFetch('/api/strategies', {
    method: 'POST',
    body: JSON.stringify({ name, nodes, edges, product_info: productInfo, ai_suggestions: aiSuggestions }),
  });
  return toCamelStrategy(await parseOrThrow(res));
}

// AUTH-004 - PATCH an existing cloud strategy in place. `expectedUpdatedAt`
// is optional: when provided, the backend performs a real conditional
// update (requirement 12, stale-write prevention) and throws a
// StrategiesApiError with status 409 and `.data.current` (the server's
// latest row, already camelCased) if it no longer matches - never a
// silent overwrite of another browser's change.
export async function updateStrategy(id, { name, nodes, edges, productInfo, aiSuggestions, expectedUpdatedAt } = {}) {
  const body = {};
  if (name !== undefined) body.name = name;
  if (nodes !== undefined) body.nodes = nodes;
  if (edges !== undefined) body.edges = edges;
  if (productInfo !== undefined) body.product_info = productInfo;
  if (aiSuggestions !== undefined) body.ai_suggestions = aiSuggestions;
  if (expectedUpdatedAt !== undefined) body.expected_updated_at = expectedUpdatedAt;
  try {
    const res = await apiFetch(`/api/strategies/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    return toCamelStrategy(await parseOrThrow(res));
  } catch (err) {
    if (err instanceof StrategiesApiError && err.status === 409 && err.data?.current) {
      // Re-throw with the conflicting row already in the same camelCase
      // shape the rest of the app expects, so the caller never has to
      // know about the backend's snake_case wire format either.
      throw new StrategiesApiError(err.status, err.message, { ...err.data, current: toCamelStrategy(err.data.current) });
    }
    throw err;
  }
}

export async function deleteStrategy(id) {
  const res = await apiFetch(`/api/strategies/${id}`, { method: 'DELETE' });
  return parseOrThrow(res);
}
