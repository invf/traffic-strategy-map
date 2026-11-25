// ADV-004 - frontend client for backend/routes/launchStrategyImportProxy.js.
// Same apiFetch/parseOrThrow convention as adveserProjects.js/strategies.js.
import { apiFetch } from '../lib/api';

// Release-readiness finding: this route is mounted only when the backend's
// own TRAFFIC_STRATEGY_MAP_STRATEGY_IMPORT_ENABLED flag is on (default
// OFF). While it is off, Express's own unmatched-route handler returns a
// plain 404 with no JSON body - a status this route's own handler can
// NEVER produce itself for a validly-shaped request (a malformed id is
// 400, and "no export yet / not a member" is a 200 with export: null, by
// design - see that route's own comment). A 404 here is therefore an
// unambiguous "this feature isn't enabled yet" signal, not a generic
// failure - carried on the thrown error so the UI can show an accurate
// message instead of implying a transient error worth retrying.
export class LaunchStrategyImportError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'LaunchStrategyImportError';
    this.status = status;
  }
}

export async function getApprovedStrategyExport(projectId) {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/approved-strategy-export`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `Failed to read the approved strategy export (${res.status})`;
    throw new LaunchStrategyImportError(res.status, message);
  }
  return data?.export ?? null;
}
