// ADV-004-FIX-4 (Strategy URL Bootstrap Race) - the exact gate App.jsx's
// URL-sync effect uses, pulled out as a pure function so it can be tested
// directly without rendering the full App tree (which mounts React Flow/
// MapCanvas - not set up for jsdom in this test environment).
//
// Confirmed root cause this exists to fix: that sync effect used to run
// unconditionally on every activeProjectId/activeProjectSource change,
// INCLUDING the very first render - before useOpenStrategyFromUrl's async
// fetch had resolved, while the store still reported whatever Local Draft
// was rehydrated from localStorage. It would see `activeProjectSource !==
// 'cloud'` and delete the just-requested `?strategy=` param before the
// fetch even started. Once auth resolved, useOpenStrategyFromUrl's own
// effect re-ran, read the (now-stripped) URL, found nothing, and got
// stuck in 'loading' forever.
//
// The fix: the sync effect must do nothing at all while a `?strategy=`
// navigation is still pending, or has only reached a state that can still
// resolve once something else completes - 'loading' (auth not yet known)
// and 'unauthorized' (not yet signed in, but might sign in and succeed -
// requirement 6, "preserve direct links across... SSO authentication").
// It may only read/write the URL once there is truly nothing left
// pending: 'idle' (no `?strategy=` param at all) or 'ready' (the
// requested strategy is already the active one). A terminal failure
// ('not-found'/'error') is deliberately NOT given back to the sync
// effect either - the URL should keep showing exactly what the user
// asked for, matching the error already on screen, rather than being
// silently rewritten out from under them.
export function shouldSyncStrategyUrl(strategyLoadState) {
  return strategyLoadState === 'idle' || strategyLoadState === 'ready';
}
