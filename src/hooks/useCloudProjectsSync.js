// AUTH-004 - the one bridge between the server-authoritative auth state
// (useAuth.js, deliberately kept out of the zustand store) and the
// store's cloud-project list. Mounted once near the app root (App.jsx).
//
// Keyed on [status, email] rather than just [status]: switching to a
// DIFFERENT account while already authenticated in the same browser
// changes `email`, which re-fires this effect and does a full
// hydrateCloudProjects() replace - never a merge with the previous
// account's list (requirement 6, "never display another account's
// cached private projects").
import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useStore } from '../store/useStore';
import { listStrategies } from '../services/strategies';

export function useCloudProjectsSync() {
  const { status, email } = useAuth();
  const hydrateCloudProjects = useStore((s) => s.hydrateCloudProjects);
  const clearCloudProjects = useStore((s) => s.clearCloudProjects);

  // Guards against a slower, now-stale fetch (e.g. a fast A->B account
  // switch) resolving AFTER a later one and clobbering it - only the
  // latest effect run's result is ever applied to the store.
  const latestRun = useRef(0);

  useEffect(() => {
    const thisRun = ++latestRun.current;

    if (status === 'authenticated') {
      listStrategies()
        .then((list) => {
          if (latestRun.current === thisRun) hydrateCloudProjects(list);
        })
        .catch(() => {
          // Fail safe, not fail open: an unreadable list is treated as
          // "none visible," never as "keep showing whatever was there."
          if (latestRun.current === thisRun) hydrateCloudProjects([]);
        });
    } else if (status === 'signed-out') {
      clearCloudProjects();
    }
    // status === 'loading': do nothing yet - the auth check hasn't
    // resolved, so there's nothing safe to hydrate or clear from yet.
  }, [status, email, hydrateCloudProjects, clearCloudProjects]);
}
