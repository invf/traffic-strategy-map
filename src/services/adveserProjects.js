// ADV-003 - frontend client for the ADV-002B shared-project listing
// endpoint (backend/routes/projectsProxy.js's GET /api/projects). Same
// apiFetch/StrategiesApiError conventions as src/services/strategies.js
// - this module never talks to Supabase/PostgREST directly, only to this
// app's own backend, which has already resolved the real identity and
// entitlement before this call is even reachable.
//
// Deliberately separate from strategies.js: an ADVESER Project
// (adveser_core.projects, shared with Launch Studio) is NOT a cloud
// strategy (public.strategies) - mixing their API clients would blur a
// distinction the UI itself must keep clear (see ProjectsSelector.jsx).
import { apiFetch } from '../lib/api';
import { StrategiesApiError } from './strategies';

async function parseOrThrow(res) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `Request failed (${res.status})`;
    throw new StrategiesApiError(res.status, message, data);
  }
  return data;
}

// Returns [] when the endpoint isn't mounted at all (404 - the shared-
// project feature flag is off, or prerequisites are incomplete server-
// side) so the UI can treat "feature not available here" the same as
// "no projects" rather than surfacing a scary error for something that
// is, from this account's perspective, just an empty/unavailable list.
// Any OTHER failure (401/403/503/network) still throws - those ARE real
// problems the caller should distinguish and surface.
export async function listAdveserProjects() {
  const res = await apiFetch('/api/projects');
  if (res.status === 404) return [];
  const data = await parseOrThrow(res);
  return data?.projects || [];
}
