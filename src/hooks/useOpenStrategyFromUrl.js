// ADV-004-FIX-2 (final correction) - loads a strategy directly from
// persistent storage when the page opens with `?strategy=<id>` in the
// URL - the mechanism that makes "a new tab receives the correct
// strategy and reloading it restores the same content" true. Mounted
// once near the app root (App.jsx), alongside useCloudProjectsSync/
// useAdveserProjectsSync.
//
// Deliberately NEVER calls importLaunchStrategy or anything in
// strategyDecisionMapping.js - opening this URL only ever reads the
// ALREADY-persisted strategy via getStrategy() and displays it via the
// existing loadStrategy() primitive. There is no code path here that
// regenerates or reconciles anything merely because this URL was
// opened - that only ever happens through the explicit "Import"/"Update
// from Launch Studio" actions in AdveserProjectsSelector.jsx.
//
// Unlike useAdveserProjectsSync.js's `?project=` param (a one-time
// navigation hint, consumed and stripped from the URL so reloading
// doesn't keep re-applying it), `?strategy=<id>` is NEVER stripped -
// reloading this exact URL must keep restoring the same strategy from
// persistent storage (requirement 8), so the URL itself has to stay
// intact.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { useStore } from '../store/useStore';
import { getStrategy, StrategiesApiError } from '../services/strategies';

// ADV-004-FIX-3 - exported so App.jsx can gate initProjects() behind the
// SAME check ("Prevent default initialization... from overwriting it" -
// requirement C) without duplicating the param-reading logic.
export function readStrategyIdFromUrl() {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('strategy');
}

// 'idle' (no ?strategy= param at all - the normal case) | 'loading' |
// 'ready' | 'unauthorized' (not signed in) | 'not-found' (signed in, but
// the strategy doesn't exist or this account has no access to it - the
// backend deliberately never distinguishes the two, same as every other
// RLS-backed lookup in this app, so this state covers both honestly) |
// 'error' (network/infrastructure failure - worth a retry, unlike the
// other two).
export function useOpenStrategyFromUrl() {
  const { status } = useAuth();
  const loadStrategy = useStore((s) => s.loadStrategy);
  // ADV-004-FIX-4 (Strategy URL Bootstrap Race) - the requested id is
  // captured EXACTLY ONCE, synchronously during the very first render
  // (a ref's lazy-init argument runs before any effect, before auth has
  // had a chance to resolve, before anything else touches the URL).
  // Every later check/fetch in this hook reads THIS captured value, never
  // `readStrategyIdFromUrl()` again - so it stays correct as "immutable
  // navigation intent" even if the live `?strategy=` param is later
  // stripped or rewritten by something else (the confirmed root cause:
  // App.jsx's own URL-sync effect used to delete it while auth was still
  // resolving, after which this hook's own effect - re-run once auth
  // settled - would re-read the URL, find nothing, and get stuck in
  // 'loading' forever). App.jsx's sync effect is now gated on this hook's
  // own return value instead, but capturing the id here too means this
  // hook's correctness never depends on what else happens to the URL.
  const pendingStrategyIdRef = useRef();
  if (pendingStrategyIdRef.current === undefined) {
    pendingStrategyIdRef.current = readStrategyIdFromUrl();
  }
  const strategyId = pendingStrategyIdRef.current;
  const [state, setState] = useState(() => (strategyId ? 'loading' : 'idle'));
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!strategyId) return;

    if (status === 'loading') return; // wait for auth to resolve first
    if (status === 'signed-out') {
      setState('unauthorized');
      return;
    }
    if (attemptedRef.current) return; // never re-fetch/regenerate on an unrelated re-render
    attemptedRef.current = true;

    setState('loading');
    getStrategy(strategyId)
      .then((strategy) => {
        loadStrategy({
          id: strategy.id,
          nodes: strategy.nodes,
          edges: strategy.edges,
          productInfo: strategy.productInfo,
          aiSuggestions: strategy.aiSuggestions,
          updatedAt: strategy.updatedAt,
        });
        setState('ready');
      })
      .catch((err) => {
        if (err instanceof StrategiesApiError && err.status === 404) {
          setState('not-found');
        } else {
          setState('error');
        }
      });
  }, [status, loadStrategy, strategyId]);

  return state;
}
