// ADV-003 - the bridge between server-authoritative auth (useAuth.js)
// and the store's ADVESER Projects list, mirroring useCloudProjectsSync.js
// exactly (same [status, email]-keyed, stale-response-guarded pattern) -
// see that file's own header for why. Mounted once near the app root
// (App.jsx), alongside it.
//
// Also the ONE place that reads a `?project=<uuid>` URL parameter (how a
// user arrives here from Launch Studio while "retaining project context,"
// requirement C) - and the only thing that matters here: the id is NEVER
// applied directly. It is looked up in the list `listAdveserProjects()`
// just returned (server-verified, membership-scoped) via
// setActiveAdveserProject(), which itself refuses any id not actually
// present in that list. A URL value that doesn't resolve - wrong project,
// no access, typo, stale link - is silently ignored, never treated as
// authorization by itself (requirement C: "Do not treat a project UUID
// supplied in a URL as authorization").
import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useStore } from '../store/useStore';
import { listAdveserProjects } from '../services/adveserProjects';

function consumeProjectParamFromUrl() {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const id = url.searchParams.get('project');
  if (!id) return null;
  // Clean the URL so reloading/sharing it later doesn't keep re-applying
  // (or re-attempting) the same navigation hint - best-effort, never
  // required for correctness (the lookup-before-apply guard above is what
  // actually matters for safety, not whether the param is still there).
  url.searchParams.delete('project');
  window.history.replaceState({}, '', url.toString());
  return id;
}

export function useAdveserProjectsSync() {
  const { status, email } = useAuth();
  const hydrateAdveserProjects = useStore((s) => s.hydrateAdveserProjects);
  const clearAdveserProjects = useStore((s) => s.clearAdveserProjects);
  const setActiveAdveserProject = useStore((s) => s.setActiveAdveserProject);

  const latestRun = useRef(0);
  // Consumed (and the URL cleaned) at most once per page load, regardless
  // of how many times this effect re-runs (e.g. an account-switch re-fire)
  // - a navigation hint is a one-time arrival signal, not something a
  // later, unrelated re-fetch should keep re-applying.
  const pendingProjectIdRef = useRef(undefined);

  useEffect(() => {
    const thisRun = ++latestRun.current;

    if (status === 'authenticated') {
      if (pendingProjectIdRef.current === undefined) {
        pendingProjectIdRef.current = consumeProjectParamFromUrl();
      }
      listAdveserProjects()
        .then((list) => {
          if (latestRun.current !== thisRun) return;
          hydrateAdveserProjects(list);
          if (pendingProjectIdRef.current) {
            setActiveAdveserProject(pendingProjectIdRef.current);
            pendingProjectIdRef.current = null;
          }
        })
        .catch(() => {
          if (latestRun.current === thisRun) hydrateAdveserProjects([]);
        });
    } else if (status === 'signed-out') {
      clearAdveserProjects();
    }
  }, [status, email, hydrateAdveserProjects, clearAdveserProjects, setActiveAdveserProject]);
}
