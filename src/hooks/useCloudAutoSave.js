// ADV-004-FIX-3 (requirement B) - reliable, debounced auto-save for
// authenticated, cloud-backed strategies. Root cause this exists to fix:
// NOTHING ever persisted a Cloud Strategy's in-memory edits back to the
// server (confirmed by TopBar.jsx's own pre-existing confirmLeaveIfDirty
// comment: "a cloud project's unsaved edits only live in memory (no
// auto-save)") - so a reload always re-fetched the LAST-SAVED (i.e.
// un-edited) server content via useOpenStrategyFromUrl.js, discarding
// anything the user had just changed. This hook is the fix: it reuses
// the EXISTING authenticated updateStrategy() API and the EXISTING
// isDirty()/lastSyncedSnapshot/setActiveCloudProject() primitives
// (AUTH-004) - no new persistence mechanism, no new table, no new route.
//
// Deliberately narrow: saves ONLY when activeProjectSource === 'cloud'
// (never a Local Draft - requirement "do not write cloud data for local
// drafts") and ONLY via updateStrategy on the EXISTING activeProjectId
// (never createStrategy - "do not create another strategy when saving
// edits"). Every field this requirement lists (labels/descriptions,
// context/notes, action plans/KPI, status/priority, positions, added/
// removed nodes/edges) is already part of the plain `nodes`/`edges`
// arrays this hook saves wholesale - no per-field special-casing needed.
import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { useStore } from '../store/useStore';
import { updateStrategy, StrategiesApiError } from '../services/strategies';

const DEBOUNCE_MS = 1500;

// Mounted once near the app root (App.jsx), alongside the other sync
// hooks. `urlLoadState` is useOpenStrategyFromUrl's own return value -
// passed in explicitly (not re-read via a second hook instance) so this
// hook can honor "avoid saving during initial hydration or URL loading"
// precisely: a `?strategy=` URL that hasn't resolved to 'ready' yet (or
// is 'idle' - no such URL at all) must never trigger a save, however the
// in-flight re-fetch happens to mutate nodes/edges along the way.
export function useCloudAutoSave(urlLoadState) {
  const { status: authStatus } = useAuth();
  const timerRef = useRef(null);
  // True while a PATCH is actually in flight. A debounce firing again
  // while this is true does not start a second overlapping request
  // (requirement: "handle repeated edits during a save without losing
  // the latest changes") - it just marks `pendingRef` and the in-flight
  // request's own `finally` re-checks real-time dirtiness and re-saves
  // immediately if anything changed meanwhile. Each save always reads
  // the LATEST canvas via getState() at the moment it actually fires,
  // never a value captured when the timer was first scheduled - this is
  // what makes "prevent older responses from overwriting newer local
  // state" true: a save's response is only ever used to update save
  // BOOKKEEPING (updatedAt/lastSyncedSnapshot-via-setActiveCloudProject),
  // never to overwrite canvas CONTENT, so there is no stale-content
  // response to apply in the first place.
  const savingRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    const attemptSave = async () => {
      if (savingRef.current) {
        pendingRef.current = true;
        return;
      }
      const s = useStore.getState();
      if (s.activeProjectSource !== 'cloud' || !s.activeProjectId) return;
      if (!s.isDirty()) {
        // Nothing to save - if a previous save left the indicator on
        // 'saving'/'error', a quiet pass back to 'saved' is still
        // correct (the last real save DID succeed) but never claimed
        // here without a server round-trip; only reachable after a
        // genuine prior success already set 'saved'/'idle'.
        return;
      }

      savingRef.current = true;
      pendingRef.current = false;
      s.setCloudSaveStatus('saving');
      s.setCloudSaveConflict(null);

      const { activeProjectId, activeCloudUpdatedAt, nodes, edges, productInfo, aiSuggestions } = useStore.getState();
      try {
        const saved = await updateStrategy(activeProjectId, {
          nodes,
          edges,
          productInfo,
          aiSuggestions,
          expectedUpdatedAt: activeCloudUpdatedAt,
        });
        // Requirement: "handle repeated edits during a save without
        // losing the latest changes." Deliberately NOT the generic
        // setActiveCloudProject(id, updatedAt) action here - that primitive
        // rebases the dirty baseline against whatever the canvas is RIGHT
        // NOW (get()), not against the request body actually sent above.
        // If the user kept editing while this PATCH was in flight, that
        // would wrongly mark their newer, never-sent edit as "synced" the
        // instant this response arrives - permanently losing it, since
        // nothing would ever isDirty()=true for it again. Setting
        // lastSyncedSnapshot from the EXACT payload this request sent
        // keeps the newer edit correctly "dirty," so the subscribe
        // listener's own scheduleSave (already fired when that edit
        // happened) runs attemptSave again and actually persists it.
        useStore.setState({
          activeProjectId: saved.id,
          activeProjectSource: 'cloud',
          activeCloudUpdatedAt: saved.updatedAt,
          lastSyncedSnapshot: JSON.stringify({ nodes, edges, productInfo, aiSuggestions }),
        });
        useStore.getState().setCloudSaveStatus('saved');
      } catch (err) {
        if (err instanceof StrategiesApiError && err.status === 409 && err.data?.current) {
          // Requirement: "handle version conflicts without silent
          // overwrite" - never retried automatically; the TopBar
          // indicator's Reload/Overwrite actions (reusing the exact
          // StrategiesModal.jsx SaveTab pattern) are the only way
          // forward from here.
          useStore.getState().setCloudSaveStatus('conflict');
          useStore.getState().setCloudSaveConflict(err.data.current);
        } else {
          // Requirement: "retry only safely; never claim a save
          // succeeded before server confirmation" - 'error' is shown
          // honestly; the NEXT edit (or the pendingRef follow-up below,
          // if one is already queued) is what actually retries, never a
          // fabricated optimistic success.
          useStore.getState().setCloudSaveStatus('error');
        }
      } finally {
        savingRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          attemptSave();
        }
      }
    };

    const scheduleSave = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(attemptSave, DEBOUNCE_MS);
    };

    // Subscribes directly (not via a React re-render) so this fires on
    // EVERY state change, including ones from outside this hook's own
    // render tree - the same approach useStore.subscribe is designed
    // for, and avoids re-creating the effect on every keystroke.
    const unsubscribe = useStore.subscribe((s, prevS) => {
      if (authStatus !== 'authenticated') return;
      if (s.activeProjectSource !== 'cloud' || !s.activeProjectId) return;
      // Requirement: "avoid saving during initial hydration or URL
      // loading" - a ?strategy= URL that hasn't resolved to 'ready' yet
      // (covers 'loading'/'unauthorized'/'not-found'/'error') must never
      // schedule a save, however nodes/edges happen to change along the
      // way (e.g. the URL loader's own loadStrategy() call, which is
      // itself a legitimate nodes/edges change this subscription would
      // otherwise see).
      if (urlLoadState !== 'idle' && urlLoadState !== 'ready') return;
      if (
        s.nodes === prevS.nodes &&
        s.edges === prevS.edges &&
        s.productInfo === prevS.productInfo &&
        s.aiSuggestions === prevS.aiSuggestions
      ) {
        return;
      }
      // isDirty() itself only evaluates true once content has genuinely
      // diverged from lastSyncedSnapshot - loadStrategy()/
      // setActiveCloudProject() both reset that baseline atomically with
      // the change that caused it (e.g. the URL loader's own initial
      // load), so this never misfires on that transition alone.
      if (!s.isDirty()) return;
      s.setCloudSaveStatus('unsaved');
      scheduleSave();
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [authStatus, urlLoadState]);

  // Requirement: "warn before navigation when edits remain unsaved" -
  // the browser's own native prompt, the only mechanism that can
  // actually intercept a tab close/reload; a custom in-app dialog cannot
  // run in time for beforeunload. Mirrors confirmLeaveIfDirty's existing
  // in-app equivalent (TopBar.jsx's ProjectSwitcher) for the in-app
  // switch case, which stays untouched.
  useEffect(() => {
    const handler = (e) => {
      if (!useStore.getState().isDirty()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}

// ADV-004-FIX-3 - the "Reload Latest"/"Overwrite Anyway" actions for the
// TopBar indicator, reusing EXACTLY the pattern StrategiesModal.jsx's
// SaveTab already established for the identical 409 shape (same
// cloud_conflict_* copy, same two outcomes) - a second, independent
// implementation would only risk drifting from it.
export async function resolveCloudSaveConflict(action) {
  const s = useStore.getState();
  if (!s.cloudSaveConflict) return;
  if (action === 'reload') {
    s.loadStrategy(s.cloudSaveConflict);
    s.setCloudSaveConflict(null);
    s.setCloudSaveStatus('saved');
    return;
  }
  // 'overwrite' - retries the EXACT SAME save, this time unconditional
  // (no expectedUpdatedAt), same as SaveTab's own handleUpdate(true).
  s.setCloudSaveStatus('saving');
  try {
    const { activeProjectId, nodes, edges, productInfo, aiSuggestions } = useStore.getState();
    const saved = await updateStrategy(activeProjectId, { nodes, edges, productInfo, aiSuggestions });
    // Same reasoning as attemptSave above - rebase the dirty baseline
    // against what was ACTUALLY just sent, not whatever is live by the
    // time the response arrives.
    useStore.setState({
      activeProjectId: saved.id,
      activeProjectSource: 'cloud',
      activeCloudUpdatedAt: saved.updatedAt,
      lastSyncedSnapshot: JSON.stringify({ nodes, edges, productInfo, aiSuggestions }),
    });
    useStore.getState().setCloudSaveConflict(null);
    useStore.getState().setCloudSaveStatus('saved');
  } catch {
    useStore.getState().setCloudSaveStatus('error');
  }
}
