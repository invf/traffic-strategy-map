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
});
