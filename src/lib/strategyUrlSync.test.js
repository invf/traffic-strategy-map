// ADV-004-FIX-4 (Strategy URL Bootstrap Race) - shouldSyncStrategyUrl is
// the exact gate App.jsx's URL-sync effect uses to decide whether it may
// touch the `?strategy=` query param this render. Tested directly (pure
// function, no React/store involved) to pin the precise rule: "no
// premature history.replaceState() removal" means this returns false for
// every state a `?strategy=` navigation could still be in.
import { describe, it, expect } from 'vitest';
import { shouldSyncStrategyUrl } from './strategyUrlSync';

describe('shouldSyncStrategyUrl (ADV-004-FIX-4)', () => {
  it('allows syncing when idle - no ?strategy= navigation in progress at all', () => {
    expect(shouldSyncStrategyUrl('idle')).toBe(true);
  });

  it('allows syncing once ready - the requested strategy is already loaded and active', () => {
    expect(shouldSyncStrategyUrl('ready')).toBe(true);
  });

  it('blocks syncing while loading - auth has not yet resolved, the URL must not be touched', () => {
    expect(shouldSyncStrategyUrl('loading')).toBe(false);
  });

  it('blocks syncing while unauthorized - the user may still sign in and the same link must keep working (SSO round-trip)', () => {
    expect(shouldSyncStrategyUrl('unauthorized')).toBe(false);
  });

  it('blocks syncing on a terminal not-found failure - the URL is left exactly as the user typed it, matching the error shown', () => {
    expect(shouldSyncStrategyUrl('not-found')).toBe(false);
  });

  it('blocks syncing on a terminal error failure, same as not-found', () => {
    expect(shouldSyncStrategyUrl('error')).toBe(false);
  });
});
