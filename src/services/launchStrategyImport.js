// ADV-004 - frontend client for backend/routes/launchStrategyImportProxy.js.
// Same apiFetch/parseOrThrow convention as adveserProjects.js/strategies.js.
import { apiFetch } from '../lib/api';

export async function getApprovedStrategyExport(projectId) {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/approved-strategy-export`);
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || `Failed to read the approved strategy export (${res.status})`;
    throw new Error(message);
  }
  return data?.export ?? null;
}
