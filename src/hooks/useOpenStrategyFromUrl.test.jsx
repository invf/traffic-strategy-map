// ADV-004-FIX-2 (final correction) - useOpenStrategyFromUrl.js: loads a
// strategy directly from persistent storage when the page opens with
// `?strategy=<id>` in the URL. Same convention as
// useAdveserProjectsSync.test.jsx (mock useAuth + the one service call,
// use the REAL store, manipulate the URL via history.replaceState).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockUseAuth = vi.fn();
vi.mock('./useAuth', () => ({ useAuth: () => mockUseAuth() }));

const getStrategy = vi.fn();
const { FakeStrategiesApiError } = vi.hoisted(() => {
  class FakeStrategiesApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }
  return { FakeStrategiesApiError };
});
vi.mock('../services/strategies', () => ({
  getStrategy: (...a) => getStrategy(...a),
  StrategiesApiError: FakeStrategiesApiError,
}));

import { useOpenStrategyFromUrl } from './useOpenStrategyFromUrl';
import { useStore } from '../store/useStore';

const RESET_STATE = { nodes: [], edges: [], productInfo: {}, aiSuggestions: null, activeProjectId: null, activeProjectSource: 'local' };

const ORIGIN = window.location.origin;
function setUrl(pathAndQuery) {
  window.history.replaceState({}, '', `${ORIGIN}${pathAndQuery}`);
}

describe('useOpenStrategyFromUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState(RESET_STATE);
    setUrl('/');
  });

  afterEach(() => {
    setUrl('/');
  });

  it('is idle when there is no ?strategy= param at all - the normal case', () => {
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    const { result } = renderHook(() => useOpenStrategyFromUrl());
    expect(result.current).toBe('idle');
    expect(getStrategy).not.toHaveBeenCalled();
  });

  it('reports "unauthorized" when a ?strategy= URL is opened while signed out', () => {
    setUrl('/?strategy=abc-123');
    mockUseAuth.mockReturnValue({ status: 'signed-out' });
    const { result } = renderHook(() => useOpenStrategyFromUrl());
    expect(result.current).toBe('unauthorized');
    expect(getStrategy).not.toHaveBeenCalled(); // never attempts a fetch while unauthenticated
  });

  it('waits ("loading") while auth is still resolving, then fetches once it is known', async () => {
    setUrl('/?strategy=abc-123');
    mockUseAuth.mockReturnValue({ status: 'loading' });
    getStrategy.mockReturnValue(new Promise(() => {})); // never resolves - only call count/timing matters here
    const { result, rerender } = renderHook(() => useOpenStrategyFromUrl());
    expect(result.current).toBe('loading');
    expect(getStrategy).not.toHaveBeenCalled();

    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    rerender();
    await waitFor(() => expect(getStrategy).toHaveBeenCalledWith('abc-123'));
  });

  it('on success, loads the REAL persisted nodes/edges into the store and reports "ready"', async () => {
    setUrl('/?strategy=abc-123');
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    const realNodes = [{ id: 'n1', type: 'custom', position: { x: 0, y: 0 }, data: { label: 'Real node' } }];
    getStrategy.mockResolvedValue({ id: 'abc-123', nodes: realNodes, edges: [], productInfo: { name: 'Real' }, aiSuggestions: null, updatedAt: '2026-01-01T00:00:00.000Z' });

    const { result } = renderHook(() => useOpenStrategyFromUrl());
    await waitFor(() => expect(result.current).toBe('ready'));

    expect(useStore.getState().nodes).toEqual(realNodes);
    expect(useStore.getState().activeProjectId).toBe('abc-123');
    expect(useStore.getState().activeProjectSource).toBe('cloud');
  });

  it('reports "not-found" on a 404 (covers both "does not exist" and "no access" - the backend deliberately never distinguishes the two)', async () => {
    setUrl('/?strategy=missing-id');
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    getStrategy.mockRejectedValue(new FakeStrategiesApiError(404, 'Strategy not found.'));

    const { result } = renderHook(() => useOpenStrategyFromUrl());
    await waitFor(() => expect(result.current).toBe('not-found'));
    expect(useStore.getState().nodes).toEqual([]); // nothing was loaded
  });

  it('reports "error" on a genuine infrastructure failure, distinct from not-found', async () => {
    setUrl('/?strategy=abc-123');
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    getStrategy.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useOpenStrategyFromUrl());
    await waitFor(() => expect(result.current).toBe('error'));
  });

  it('never re-fetches (or regenerates anything) on an unrelated re-render once a load has already been attempted', async () => {
    setUrl('/?strategy=abc-123');
    mockUseAuth.mockReturnValue({ status: 'authenticated' });
    getStrategy.mockResolvedValue({ id: 'abc-123', nodes: [], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: '2026-01-01T00:00:00.000Z' });

    const { result, rerender } = renderHook(() => useOpenStrategyFromUrl());
    await waitFor(() => expect(result.current).toBe('ready'));
    expect(getStrategy).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    expect(getStrategy).toHaveBeenCalledTimes(1); // still exactly once - opening/reloading this URL never triggers regeneration
  });

  // ADV-004-FIX-4 (Strategy URL Bootstrap Race) - confirmed root cause:
  // App.jsx's own URL-sync effect used to run on the very first render,
  // before this hook's async fetch resolved, saw the store still
  // reporting a Local Draft (rehydrated from localStorage) and deleted
  // the just-requested `?strategy=` param. Once auth resolved, this
  // hook's own effect re-read the (now-stripped) URL, found nothing, and
  // stayed stuck on 'loading' forever. These tests prove the fix: the id
  // is captured once, immutably, and the fetch proceeds from that
  // captured value regardless of what happens to the live URL afterward.
  describe('Strategy URL Bootstrap Race (ADV-004-FIX-4)', () => {
    it('direct ?strategy=<uuid> URL with an initially-local store (RESET_STATE itself) still resolves - the hook never depends on activeProjectSource', async () => {
      setUrl('/?strategy=abc-123');
      expect(useStore.getState().activeProjectSource).toBe('local'); // the exact pre-condition that used to trigger the bug
      mockUseAuth.mockReturnValue({ status: 'authenticated' });
      getStrategy.mockResolvedValue({ id: 'abc-123', nodes: [{ id: 'n1' }], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });

      const { result } = renderHook(() => useOpenStrategyFromUrl());
      await waitFor(() => expect(result.current).toBe('ready'));
      expect(useStore.getState().activeProjectSource).toBe('cloud');
    });

    it('slow authentication: the requested id survives even if something else strips ?strategy= from the URL while auth is still resolving', async () => {
      setUrl('/?strategy=abc-123');
      mockUseAuth.mockReturnValue({ status: 'loading' });
      getStrategy.mockResolvedValue({ id: 'abc-123', nodes: [{ id: 'n1' }], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });

      const { result, rerender } = renderHook(() => useOpenStrategyFromUrl());
      expect(result.current).toBe('loading');

      // Simulates the OLD bug: something (the un-gated sync effect) wipes
      // the URL's ?strategy= param while auth is still pending.
      setUrl('/');
      expect(readStrategyIdFromUrlLive()).toBe(null);

      // Auth now resolves.
      mockUseAuth.mockReturnValue({ status: 'authenticated' });
      rerender();

      // The hook must still fetch the ORIGINALLY requested id - captured
      // before the URL was mutated - never read the (now-empty) live URL.
      await waitFor(() => expect(getStrategy).toHaveBeenCalledWith('abc-123'));
      await waitFor(() => expect(result.current).toBe('ready'));
    });

    it('SSO authentication (account switching mid-flight): signed-out -> authenticated still resolves even though the URL lost its param while unauthorized', async () => {
      setUrl('/?strategy=abc-123');
      mockUseAuth.mockReturnValue({ status: 'signed-out' });
      getStrategy.mockResolvedValue({ id: 'abc-123', nodes: [{ id: 'n1' }], edges: [], productInfo: {}, aiSuggestions: null, updatedAt: 't1' });

      const { result, rerender } = renderHook(() => useOpenStrategyFromUrl());
      await waitFor(() => expect(result.current).toBe('unauthorized'));
      expect(getStrategy).not.toHaveBeenCalled();

      // The user completes SSO elsewhere; meanwhile the URL's param is
      // gone (whether from the old bug or an unrelated navigation) - the
      // hook's own captured id must not care.
      setUrl('/');

      mockUseAuth.mockReturnValue({ status: 'authenticated' });
      rerender();

      await waitFor(() => expect(getStrategy).toHaveBeenCalledWith('abc-123'));
      await waitFor(() => expect(result.current).toBe('ready'));
      expect(useStore.getState().activeProjectId).toBe('abc-123');
    });

    it('never gets stuck in "loading" forever - every path (success/not-found/error/unauthorized) reaches a terminal, non-loading state', async () => {
      setUrl('/?strategy=abc-123');
      mockUseAuth.mockReturnValue({ status: 'authenticated' });
      getStrategy.mockRejectedValue(new FakeStrategiesApiError(404, 'not found'));

      const { result } = renderHook(() => useOpenStrategyFromUrl());
      await waitFor(() => expect(result.current).not.toBe('loading'));
      expect(result.current).toBe('not-found');
    });

    it('switching to a DIFFERENT Cloud Strategy after the initial URL load stays "ready" - never re-fetches or regresses to "loading"', async () => {
      setUrl('/?strategy=strategy-A');
      mockUseAuth.mockReturnValue({ status: 'authenticated' });
      getStrategy.mockResolvedValue({ id: 'strategy-A', nodes: [{ id: 'a1' }], edges: [], productInfo: { name: 'A' }, aiSuggestions: null, updatedAt: 'a-t1' });

      const { result, rerender } = renderHook(() => useOpenStrategyFromUrl());
      await waitFor(() => expect(result.current).toBe('ready'));
      expect(useStore.getState().activeProjectId).toBe('strategy-A');

      // The user now switches to a different Cloud Strategy via the
      // Project Switcher / StrategiesModal (the same loadStrategy()
      // primitive those UI entry points call) - not through this URL.
      useStore.getState().loadStrategy({ id: 'strategy-B', nodes: [{ id: 'b1' }], edges: [], productInfo: { name: 'B' }, aiSuggestions: null, updatedAt: 'b-t1' });
      rerender();

      expect(result.current).toBe('ready'); // still ready - never re-enters 'loading'
      expect(getStrategy).toHaveBeenCalledTimes(1); // never re-fetched strategy A, and never fetches B either (it wasn't opened via URL)
      expect(useStore.getState().activeProjectId).toBe('strategy-B');
      expect(useStore.getState().nodes).toEqual([{ id: 'b1' }]);
    });
  });
});

// Reads the LIVE url directly (not the hook's captured ref) - used only to
// assert the test's own simulated mutation actually took effect.
function readStrategyIdFromUrlLive() {
  return new URLSearchParams(window.location.search).get('strategy');
}
